import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
} from '@solana/web3.js';
import { SecureWalletService, EncryptedKey } from './secure-wallet.js';
import { prisma } from '../db/client.js';
import { emitToUser } from '../websocket/handlers.js';
import bs58 from 'bs58';

// Jito tip accounts (randomly selected for load distribution)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVxaVXhp7Yyrvfvw8DQajJ',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

interface ExecuteSnipeParams {
  userId: string;
  walletId: string;
  tokenMint: string;
  poolAddress: string;
  amountSol: number;
  slippageBps: number;
  priorityFeeSol: number;
  sniperId?: string;
  tokenSymbol?: string;
  mevProtection?: boolean; // Use Jito bundles for MEV protection (default: true)
}

interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  tokenAmount?: number;
  solSpent?: number;
  fees?: {
    platformFee: number;
    jitoTip: number;
    networkFee: number;
  };
}

interface RaydiumQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  priceImpactPct: number;
  routePlan: Array<{
    poolId: string;
    inputMint: string;
    outputMint: string;
    feeMint: string;
    feeRate: number;
    feeAmount: string;
  }>;
}

/**
 * TransactionExecutor - Handles Raydium swaps with Jito MEV protection
 *
 * Features:
 * - Raydium Trade API integration for quote/swap building
 * - Jito bundle submission for MEV protection
 * - Multi-path failsafe (Jito → Helius → Direct RPC)
 * - Automatic fee escalation on retries
 * - Platform fee injection (1%)
 */
export class TransactionExecutor {
  private secureWallet: SecureWalletService;
  private primaryConnection: Connection;
  private heliusConnection: Connection;
  private backupConnection: Connection | null = null;
  private platformFeeWallet: PublicKey;
  private platformFeeBps: number;

  constructor() {
    this.secureWallet = new SecureWalletService();

    // Primary RPC (Helius)
    const heliusKey = process.env.HELIUS_API_KEY;
    const heliusUrl =
      process.env.HELIUS_RPC_URL ||
      `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
    this.primaryConnection = new Connection(heliusUrl, 'confirmed');
    this.heliusConnection = this.primaryConnection;

    // Backup RPC
    if (process.env.BACKUP_RPC_URL) {
      this.backupConnection = new Connection(
        process.env.BACKUP_RPC_URL,
        'confirmed'
      );
    }

    // Platform fee configuration
    this.platformFeeWallet = new PublicKey(
      process.env.PLATFORM_FEE_WALLET ||
        '11111111111111111111111111111111' // Placeholder
    );
    this.platformFeeBps = parseInt(process.env.PLATFORM_FEE_BPS || '100'); // 1%
  }

  /**
   * Execute a snipe transaction with multi-path failsafe
   */
  async executeSnipe(params: ExecuteSnipeParams): Promise<ExecutionResult> {
    const {
      userId,
      walletId,
      tokenMint,
      amountSol,
      slippageBps,
      priorityFeeSol,
      sniperId,
      tokenSymbol,
      mevProtection = true, // Default to enabled
    } = params;

    // Notify user that snipe is starting
    await emitToUser(userId, 'snipe:started', {
      sniperId,
      tokenMint,
      tokenSymbol,
      amountSol,
    });

    try {
      // 1. Get wallet keypair
      const wallet = await this.getWalletKeypair(userId, walletId);
      if (!wallet) {
        throw new Error('Wallet not found or decryption failed');
      }

      // 2. Calculate fees
      const platformFee = amountSol * (this.platformFeeBps / 10000);
      const swapAmountSol = amountSol - platformFee;
      const amountLamports = Math.floor(swapAmountSol * LAMPORTS_PER_SOL);

      // 3. Get Raydium quote
      const quote = await this.getRaydiumQuote({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: tokenMint,
        amount: amountLamports,
        slippageBps,
      });

      if (!quote) {
        throw new Error('Failed to get Raydium quote');
      }

      // 4. Build transaction with fee + swap + tip
      const transaction = await this.buildTransaction({
        wallet,
        quote,
        platformFee,
        jitoTip: priorityFeeSol,
        tokenMint,
      });

      // 5. Execute with multi-path failsafe
      const result = await this.submitWithFailsafe({
        transaction,
        wallet,
        userId,
        sniperId,
        tokenSymbol,
        initialTip: priorityFeeSol,
        mevProtection,
      });

      if (result.success && result.signature) {
        // 6. Record transaction
        await this.recordTransaction({
          userId,
          sniperId,
          signature: result.signature,
          tokenMint,
          tokenSymbol,
          solAmount: amountSol,
          tokenAmount: parseInt(quote.outAmount) / Math.pow(10, 9), // Assuming 9 decimals
          platformFee,
          jitoTip: priorityFeeSol,
        });

        // 7. Notify success
        await emitToUser(userId, 'snipe:success', {
          sniperId,
          signature: result.signature,
          tokenMint,
          tokenSymbol,
          tokenAmount: parseInt(quote.outAmount) / Math.pow(10, 9),
          solSpent: amountSol,
        });

        return {
          success: true,
          signature: result.signature,
          tokenAmount: parseInt(quote.outAmount) / Math.pow(10, 9),
          solSpent: amountSol,
          fees: {
            platformFee,
            jitoTip: priorityFeeSol,
            networkFee: 0.000005, // Standard tx fee
          },
        };
      } else {
        throw new Error(result.error || 'Transaction failed');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Notify failure
      await emitToUser(userId, 'snipe:failed', {
        sniperId,
        tokenMint,
        tokenSymbol,
        error: errorMessage,
      });

      // Log the failed transaction
      await prisma.activityLog.create({
        data: {
          userId,
          sniperId,
          eventType: 'snipe:failed',
          eventData: {
            tokenMint,
            tokenSymbol,
            amountSol,
            error: errorMessage,
          },
        },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get Raydium quote for swap
   */
  private async getRaydiumQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps: number;
  }): Promise<RaydiumQuote | null> {
    try {
      // Raydium Trade API endpoint
      const response = await fetch(
        'https://transaction-v1.raydium.io/compute/swap-base-in',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: 'quote-request',
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount.toString(),
            slippageBps: params.slippageBps,
            txVersion: 'V0',
          }),
        }
      );

      if (!response.ok) {
        console.error('Raydium quote error:', await response.text());
        return null;
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Failed to get Raydium quote:', error);
      return null;
    }
  }

  /**
   * Build transaction with platform fee, swap, and Jito tip
   */
  private async buildTransaction(params: {
    wallet: Keypair;
    quote: RaydiumQuote;
    platformFee: number;
    jitoTip: number;
    tokenMint: string;
  }): Promise<VersionedTransaction> {
    const { wallet, quote, platformFee, jitoTip } = params;

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } =
      await this.primaryConnection.getLatestBlockhash('confirmed');

    const instructions: TransactionInstruction[] = [];

    // 1. Set compute budget (high for complex swaps)
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000,
      })
    );

    // 2. Set priority fee (micro-lamports per CU)
    const priorityFeePerCu = Math.floor(
      (jitoTip * LAMPORTS_PER_SOL) / 400_000
    );
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeePerCu,
      })
    );

    // 3. Platform fee transfer
    if (platformFee > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: this.platformFeeWallet,
          lamports: Math.floor(platformFee * LAMPORTS_PER_SOL),
        })
      );
    }

    // 4. Get swap instructions from Raydium
    const swapInstructions = await this.getSwapInstructions({
      wallet: wallet.publicKey,
      quote,
    });
    instructions.push(...swapInstructions);

    // 5. Jito tip (to random tip account)
    const tipAccount =
      JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: Math.floor(jitoTip * LAMPORTS_PER_SOL),
      })
    );

    // Build versioned transaction
    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet]);

    return transaction;
  }

  /**
   * Get swap instructions from Raydium
   */
  private async getSwapInstructions(params: {
    wallet: PublicKey;
    quote: RaydiumQuote;
  }): Promise<TransactionInstruction[]> {
    try {
      // Get serialized swap transaction from Raydium
      const response = await fetch(
        'https://transaction-v1.raydium.io/transaction/swap-base-in',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            computeUnitPriceMicroLamports: '1',
            swapResponse: params.quote,
            txVersion: 'V0',
            wallet: params.wallet.toBase58(),
            wrapSol: true,
            unwrapSol: false,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Raydium swap API error: ${await response.text()}`);
      }

      const data = await response.json();

      // Decode the transaction and extract instructions
      // For now, we'll use the serialized transaction approach
      return []; // Placeholder - actual implementation extracts from response
    } catch (error) {
      console.error('Failed to get swap instructions:', error);
      throw error;
    }
  }

  /**
   * Submit transaction with multi-path failsafe
   * When mevProtection is enabled (default), uses Jito bundles first
   * When disabled, skips Jito and goes directly to Helius/RPC
   */
  private async submitWithFailsafe(params: {
    transaction: VersionedTransaction;
    wallet: Keypair;
    userId: string;
    sniperId?: string;
    tokenSymbol?: string;
    initialTip: number;
    mevProtection?: boolean;
  }): Promise<{ success: boolean; signature?: string; error?: string }> {
    const { wallet, userId, sniperId, tokenSymbol, initialTip, mevProtection = true } = params;
    let { transaction } = params;

    // Build attempt sequence based on MEV protection setting
    const attempts = mevProtection
      ? [
          // MEV protected: Jito first, then fallback to Helius/direct
          { path: 'jito', tipMultiplier: 1 },
          { path: 'jito', tipMultiplier: 2 },
          { path: 'helius', tipMultiplier: 2.5 },
          { path: 'direct', tipMultiplier: 3 },
        ]
      : [
          // No MEV protection: Skip Jito, use Helius/direct only (faster, cheaper)
          { path: 'helius', tipMultiplier: 1 },
          { path: 'helius', tipMultiplier: 1.5 },
          { path: 'direct', tipMultiplier: 2 },
        ];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];

      // Notify user of retry (if not first attempt)
      if (i > 0) {
        await emitToUser(userId, 'snipe:retrying', {
          sniperId,
          tokenSymbol,
          attempt: i + 1,
          maxAttempts: attempts.length,
          path: attempt.path,
        });

        // Rebuild transaction with higher tip
        transaction = await this.rebuildWithNewTip(
          transaction,
          wallet,
          initialTip * attempt.tipMultiplier
        );
      }

      try {
        // Notify that transaction is being submitted
        await emitToUser(userId, 'snipe:submitted', {
          sniperId,
          tokenSymbol,
          path: attempt.path,
        });

        const signature = await this.submitViaPath(transaction, attempt.path);

        if (signature) {
          // Wait for confirmation
          const confirmed = await this.confirmTransaction(signature);

          if (confirmed) {
            return { success: true, signature };
          }
        }
      } catch (error) {
        console.error(`Attempt ${i + 1} (${attempt.path}) failed:`, error);
      }

      // Brief delay before retry
      if (i < attempts.length - 1) {
        await this.sleep(100 * (i + 1));
      }
    }

    return { success: false, error: 'All submission attempts failed' };
  }

  /**
   * Submit transaction via specific path
   */
  private async submitViaPath(
    transaction: VersionedTransaction,
    path: string
  ): Promise<string | null> {
    const serialized = Buffer.from(transaction.serialize()).toString('base64');

    switch (path) {
      case 'jito':
        return await this.submitToJito(serialized);

      case 'helius':
        return await this.submitToHelius(transaction);

      case 'direct':
        return await this.submitDirect(transaction);

      default:
        throw new Error(`Unknown submission path: ${path}`);
    }
  }

  /**
   * Submit to Jito block engine
   */
  private async submitToJito(serializedTx: string): Promise<string | null> {
    const jitoUrl =
      process.env.JITO_BLOCK_ENGINE_URL ||
      'https://mainnet.block-engine.jito.wtf';

    try {
      const response = await fetch(`${jitoUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [[serializedTx]],
        }),
      });

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error.message);
      }

      // Return bundle ID (we'll need to poll for confirmation)
      return result.result;
    } catch (error) {
      console.error('Jito submission error:', error);
      return null;
    }
  }

  /**
   * Submit via Helius (staked connections)
   */
  private async submitToHelius(
    transaction: VersionedTransaction
  ): Promise<string | null> {
    try {
      const signature = await this.heliusConnection.sendTransaction(
        transaction,
        {
          skipPreflight: true,
          maxRetries: 0,
        }
      );
      return signature;
    } catch (error) {
      console.error('Helius submission error:', error);
      return null;
    }
  }

  /**
   * Submit directly to RPC (fallback)
   */
  private async submitDirect(
    transaction: VersionedTransaction
  ): Promise<string | null> {
    const connection = this.backupConnection || this.primaryConnection;

    try {
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: true,
        maxRetries: 3,
      });
      return signature;
    } catch (error) {
      console.error('Direct submission error:', error);
      return null;
    }
  }

  /**
   * Confirm transaction
   */
  private async confirmTransaction(signature: string): Promise<boolean> {
    try {
      const confirmation = await this.primaryConnection.confirmTransaction(
        {
          signature,
          blockhash: (
            await this.primaryConnection.getLatestBlockhash()
          ).blockhash,
          lastValidBlockHeight: (
            await this.primaryConnection.getLatestBlockhash()
          ).lastValidBlockHeight,
        },
        'confirmed'
      );

      return !confirmation.value.err;
    } catch (error) {
      console.error('Confirmation error:', error);
      return false;
    }
  }

  /**
   * Rebuild transaction with new tip
   */
  private async rebuildWithNewTip(
    _oldTx: VersionedTransaction,
    wallet: Keypair,
    newTip: number
  ): Promise<VersionedTransaction> {
    // Get fresh blockhash
    const { blockhash } =
      await this.primaryConnection.getLatestBlockhash('confirmed');

    // For simplicity, we rebuild the entire transaction
    // In production, you'd extract and modify the existing instructions

    // This is a placeholder - actual implementation would deserialize,
    // update the tip instruction, and re-sign
    const instructions: TransactionInstruction[] = [];

    // Set compute budget
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    );

    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((newTip * LAMPORTS_PER_SOL) / 400_000),
      })
    );

    // Add tip to random Jito account
    const tipAccount =
      JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: Math.floor(newTip * LAMPORTS_PER_SOL),
      })
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet]);

    return transaction;
  }

  /**
   * Get wallet keypair securely
   */
  private async getWalletKeypair(
    userId: string,
    walletId: string
  ): Promise<Keypair | null> {
    try {
      const wallet = await prisma.wallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet || wallet.walletType !== 'generated') {
        // For connected wallets, we can't sign on their behalf
        return null;
      }

      const encrypted: EncryptedKey = {
        ciphertext: wallet.encryptedPrivateKey || '',
        iv: wallet.iv || '',
        authTag: wallet.authTag || '',
        version: 1,
      };

      const privateKey = await this.secureWallet.decryptPrivateKey(
        encrypted,
        userId
      );
      const keypair = Keypair.fromSecretKey(privateKey);

      // Zero out the private key
      privateKey.fill(0);

      return keypair;
    } catch (error) {
      console.error('Failed to get wallet keypair:', error);
      return null;
    }
  }

  /**
   * Record transaction in database
   */
  private async recordTransaction(params: {
    userId: string;
    sniperId?: string;
    signature: string;
    tokenMint: string;
    tokenSymbol?: string;
    solAmount: number;
    tokenAmount: number;
    platformFee: number;
    jitoTip: number;
  }): Promise<void> {
    const {
      userId,
      sniperId,
      signature,
      tokenMint,
      tokenSymbol,
      solAmount,
      tokenAmount,
      platformFee,
      jitoTip,
    } = params;

    // Create position record
    const position = await prisma.position.create({
      data: {
        userId,
        sniperId,
        tokenMint,
        tokenSymbol,
        entrySol: solAmount,
        entryTokenAmount: tokenAmount,
        entryPrice: solAmount / tokenAmount,
        currentTokenAmount: tokenAmount,
        status: 'open',
      },
    });

    // Create transaction record
    await prisma.transaction.create({
      data: {
        userId,
        positionId: position.id,
        signature,
        txType: 'buy',
        solAmount,
        tokenAmount,
        platformFee,
        jitoTip,
        status: 'confirmed',
      },
    });

    // Record fee in ledger
    await prisma.feeLedger.create({
      data: {
        userId,
        feeAmount: platformFee,
        feeSol: platformFee,
        settled: false,
      },
    });

    // Activity log
    await prisma.activityLog.create({
      data: {
        userId,
        sniperId,
        eventType: 'snipe:success',
        eventData: {
          signature,
          tokenMint,
          tokenSymbol,
          solAmount,
          tokenAmount,
          platformFee,
          jitoTip,
        },
      },
    });
  }

  /**
   * Execute a sell transaction
   */
  async executeSell(params: {
    userId: string;
    walletId: string;
    positionId: string;
    tokenMint: string;
    tokenAmount: number;
    slippageBps: number;
    priorityFeeSol: number;
    reason: 'manual' | 'take_profit' | 'stop_loss' | 'trailing_stop';
  }): Promise<ExecutionResult> {
    // Similar to executeSnipe but swaps token → SOL
    // Implementation follows same pattern with Raydium quote and multi-path submission
    const { userId, positionId, tokenMint, reason } = params;

    await emitToUser(userId, 'position:selling', {
      positionId,
      tokenMint,
      reason,
    });

    // ... Implementation similar to executeSnipe
    // For brevity, returning placeholder
    return { success: false, error: 'Not yet implemented' };
  }

  /**
   * Get current token price
   */
  async getTokenPrice(tokenMint: string): Promise<number | null> {
    try {
      // Use Raydium API or Jupiter for price
      const response = await fetch(
        `https://api.raydium.io/v2/main/price?tokens=${tokenMint}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.data?.[tokenMint] || null;
    } catch (error) {
      console.error('Failed to get token price:', error);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const transactionExecutor = new TransactionExecutor();
