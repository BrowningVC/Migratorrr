import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { SecureWalletService, EncryptedKey } from './secure-wallet.js';
import { prisma } from '../db/client.js';
import { emitToUser } from '../websocket/handlers.js';

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

// Multiple Jito block engines for parallel submission (speed optimization)
const JITO_BLOCK_ENGINES = [
  'https://mainnet.block-engine.jito.wtf',
  'https://amsterdam.mainnet.block-engine.jito.wtf',
  'https://frankfurt.mainnet.block-engine.jito.wtf',
  'https://ny.mainnet.block-engine.jito.wtf',
  'https://tokyo.mainnet.block-engine.jito.wtf',
];

// SOL mint address
const SOL_MINT = 'So11111111111111111111111111111111111111112';

interface ExecuteSnipeParams {
  userId: string;
  walletId: string;
  tokenMint: string;
  poolAddress?: string;
  amountSol: number;
  slippageBps: number;
  priorityFeeSol: number;
  sniperId?: string;
  tokenSymbol?: string;
  mevProtection?: boolean;
}

interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  tokenAmount?: number;
  solSpent?: number;
  solReceived?: number;
  fees?: {
    platformFee: number;
    jitoTip: number;
    networkFee: number;
  };
}

interface RaydiumSwapResponse {
  id: string;
  success: boolean;
  data: {
    swapType: string;
    inputMint: string;
    inputAmount: string;
    outputMint: string;
    outputAmount: string;
    otherAmountThreshold: string;
    slippageBps: number;
    priceImpactPct: number;
    routePlan: Array<{
      poolId: string;
      inputMint: string;
      outputMint: string;
      feeMint: string;
      feeRate: number;
      feeAmount: string;
    }>;
  };
}

interface RaydiumTxResponse {
  id: string;
  success: boolean;
  data: {
    transaction: string; // Base64 encoded versioned transaction
  }[];
}

// Cache for storing swap data between retries
interface SwapContext {
  quote: RaydiumSwapResponse['data'];
  wallet: Keypair;
  walletId: string;
  platformFee: number;
  tokenMint: string;
  tokenSymbol?: string;
  sniperId?: string;
  userId: string;
  isBuy: boolean;
  positionId?: string;
}

/**
 * TransactionExecutor - High-speed Raydium swaps with Jito MEV protection
 *
 * Speed optimizations:
 * - Parallel Jito submission to multiple block engines
 * - Pre-fetched blockhash caching
 * - Minimal instruction rebuilding on retry
 * - Skip preflight for faster submission
 *
 * MEV Protection:
 * - Jito private mempool (transactions not visible to searchers)
 * - Atomic bundle execution
 * - Random tip account selection
 *
 * User Communication:
 * - Real-time WebSocket events at every step
 * - Detailed error messages
 * - Progress tracking for retries
 */
export class TransactionExecutor {
  private secureWallet: SecureWalletService;
  private primaryConnection: Connection;
  private heliusConnection: Connection;
  private backupConnection: Connection | null = null;
  private platformFeeWallet: PublicKey;
  private platformFeeBps: number;

  // Blockhash cache for speed
  // Increased from 2s to 30s to reduce Helius RPC calls significantly
  // Blockhashes are valid for ~90 slots (~45 seconds), so 30s cache is safe
  private cachedBlockhash: { blockhash: string; lastValidBlockHeight: number; fetchedAt: number } | null = null;
  private readonly BLOCKHASH_CACHE_MS = 30000; // Refresh every 30 seconds (was 2s)

  // Lookup table cache - these rarely change, cache for 5 minutes
  private lookupTableCache = new Map<string, { account: AddressLookupTableAccount; fetchedAt: number }>();
  private readonly LOOKUP_TABLE_CACHE_MS = 300000; // 5 minutes

  constructor() {
    this.secureWallet = new SecureWalletService();

    // Primary RPC (Helius)
    const heliusKey = process.env.HELIUS_API_KEY;
    const heliusUrl =
      process.env.HELIUS_RPC_URL ||
      `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
    this.primaryConnection = new Connection(heliusUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 30000,
    });
    this.heliusConnection = this.primaryConnection;

    // Backup RPC
    if (process.env.BACKUP_RPC_URL) {
      this.backupConnection = new Connection(process.env.BACKUP_RPC_URL, 'confirmed');
    }

    // Platform fee configuration - CRITICAL: Must be a valid wallet address
    const feeWalletAddress = process.env.PLATFORM_FEE_WALLET;
    if (!feeWalletAddress || feeWalletAddress === '11111111111111111111111111111111') {
      throw new Error(
        'CRITICAL: PLATFORM_FEE_WALLET environment variable must be set to a valid Solana wallet address. ' +
        'The system program address (11111...11111) is not valid for receiving fees.'
      );
    }

    try {
      this.platformFeeWallet = new PublicKey(feeWalletAddress);
    } catch {
      throw new Error(`CRITICAL: Invalid PLATFORM_FEE_WALLET address: ${feeWalletAddress}`);
    }

    this.platformFeeBps = parseInt(process.env.PLATFORM_FEE_BPS || '100'); // 1%

    // Start blockhash refresh loop
    this.startBlockhashRefresh();
  }

  /**
   * Background blockhash refresh for speed
   */
  private startBlockhashRefresh(): void {
    const refresh = async () => {
      try {
        const { blockhash, lastValidBlockHeight } = await this.primaryConnection.getLatestBlockhash('confirmed');
        this.cachedBlockhash = { blockhash, lastValidBlockHeight, fetchedAt: Date.now() };
      } catch (error) {
        console.error('Blockhash refresh error:', error);
      }
    };

    // Initial fetch
    refresh();

    // Refresh every 2 seconds
    setInterval(refresh, this.BLOCKHASH_CACHE_MS);
  }

  /**
   * Get cached or fresh blockhash
   */
  private async getBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    if (this.cachedBlockhash && Date.now() - this.cachedBlockhash.fetchedAt < this.BLOCKHASH_CACHE_MS) {
      return { blockhash: this.cachedBlockhash.blockhash, lastValidBlockHeight: this.cachedBlockhash.lastValidBlockHeight };
    }

    const result = await this.primaryConnection.getLatestBlockhash('confirmed');
    this.cachedBlockhash = { ...result, fetchedAt: Date.now() };
    return result;
  }

  /**
   * Execute a snipe (buy) transaction with multi-path failsafe
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
      mevProtection = true,
    } = params;

    const startTime = Date.now();
    const tokenLabel = tokenSymbol || tokenMint.slice(0, 8);

    console.log(`\n💰 [TX EXECUTOR] Starting BUY transaction`);
    console.log(`   Token: ${tokenLabel} (${tokenMint})`);
    console.log(`   Amount: ${amountSol} SOL, Slippage: ${slippageBps}bps, Tip: ${priorityFeeSol} SOL`);
    console.log(`   MEV Protection: ${mevProtection ? 'ON' : 'OFF'}`);

    // Notify user immediately
    await emitToUser(userId, 'snipe:started', {
      sniperId,
      tokenMint,
      tokenSymbol: tokenLabel,
      amountSol,
      timestamp: startTime,
    });

    try {
      console.log(`   📡 Fetching wallet keypair and Raydium quote...`);
      const quoteStartTime = Date.now();

      // 1. Get wallet keypair (parallel with quote fetch for speed)
      const [wallet, quote] = await Promise.all([
        this.getWalletKeypair(userId, walletId),
        this.getRaydiumQuote({
          inputMint: SOL_MINT,
          outputMint: tokenMint,
          amount: Math.floor(amountSol * LAMPORTS_PER_SOL),
          slippageBps,
          isBuy: true,
        }),
      ]);

      const quoteDuration = Date.now() - quoteStartTime;

      if (!wallet) {
        console.log(`   ❌ Wallet decryption failed`);
        throw new Error('Wallet not found or decryption failed');
      }
      console.log(`   ✓ Wallet decrypted (${wallet.publicKey.toBase58().slice(0, 8)}...)`);

      if (!quote) {
        console.log(`   ❌ Raydium quote failed - no liquidity?`);
        throw new Error('Failed to get Raydium quote - token may not have liquidity');
      }

      const expectedTokens = parseInt(quote.outputAmount) / 1e9;
      console.log(`   ✓ Quote received in ${quoteDuration}ms`);
      console.log(`      Expected tokens: ${expectedTokens.toFixed(4)}`);
      console.log(`      Price impact: ${quote.priceImpactPct}%`);

      // Notify quote received
      await emitToUser(userId, 'snipe:quote', {
        sniperId,
        tokenSymbol: tokenLabel,
        expectedTokens,
        priceImpact: quote.priceImpactPct,
        latencyMs: Date.now() - startTime,
      });

      // 2. Calculate fees
      const platformFee = amountSol * (this.platformFeeBps / 10000);
      console.log(`   Platform fee: ${platformFee.toFixed(6)} SOL (${this.platformFeeBps}bps)`);

      // 3. Build and sign transaction
      console.log(`   🔨 Building transaction...`);
      const buildStartTime = Date.now();

      const swapContext: SwapContext = {
        quote,
        wallet,
        walletId,
        platformFee,
        tokenMint,
        tokenSymbol,
        sniperId,
        userId,
        isBuy: true,
      };

      const transaction = await this.buildSwapTransaction(swapContext, priorityFeeSol);
      console.log(`   ✓ Transaction built in ${Date.now() - buildStartTime}ms`);

      // 4. Submit with MEV protection
      console.log(`   📤 Submitting transaction...`);
      const submitStartTime = Date.now();

      const result = await this.submitWithFailsafe({
        transaction,
        swapContext,
        initialTip: priorityFeeSol,
        mevProtection,
      });

      const submitDuration = Date.now() - submitStartTime;

      if (result.success && result.signature) {
        const tokenAmount = parseInt(quote.outputAmount) / 1e9;
        const totalDuration = Date.now() - startTime;

        console.log(`   ✅ TRANSACTION CONFIRMED!`);
        console.log(`      Signature: ${result.signature}`);
        console.log(`      Submit time: ${submitDuration}ms`);
        console.log(`      Total time: ${totalDuration}ms`);

        // 5. Record transaction (don't await - do in background for speed)
        this.recordTransaction({
          userId,
          walletId,
          sniperId,
          signature: result.signature,
          tokenMint,
          tokenSymbol,
          solAmount: amountSol,
          tokenAmount,
          platformFee,
          jitoTip: priorityFeeSol,
          txType: 'buy',
        }).catch(err => console.error('Failed to record transaction:', err));

        // 6. Notify success
        await emitToUser(userId, 'snipe:success', {
          sniperId,
          signature: result.signature,
          tokenMint,
          tokenSymbol: tokenLabel,
          tokenAmount,
          solSpent: amountSol,
          totalLatencyMs: totalDuration,
        });

        return {
          success: true,
          signature: result.signature,
          tokenAmount,
          solSpent: amountSol,
          fees: {
            platformFee,
            jitoTip: priorityFeeSol,
            networkFee: 0.000005,
          },
        };
      } else {
        console.log(`   ❌ Transaction failed after all retries: ${result.error}`);
        throw new Error(result.error || 'Transaction failed after all retries');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const totalDuration = Date.now() - startTime;

      console.log(`   💥 TRANSACTION FAILED: ${errorMessage}`);
      console.log(`      Duration: ${totalDuration}ms`);

      // Notify failure
      await emitToUser(userId, 'snipe:failed', {
        sniperId,
        tokenMint,
        tokenSymbol: tokenLabel,
        error: errorMessage,
        totalLatencyMs: totalDuration,
      });

      // Log failure (background)
      prisma.activityLog.create({
        data: {
          userId,
          sniperId,
          eventType: 'snipe:failed',
          eventData: { tokenMint, tokenSymbol, amountSol, error: errorMessage },
        },
      }).catch(err => console.error('Failed to log activity:', err));

      return { success: false, error: errorMessage };
    }
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
    tokenDecimals?: number;
    slippageBps: number;
    priorityFeeSol: number;
    reason: 'manual' | 'take_profit' | 'stop_loss' | 'trailing_stop';
    tokenSymbol?: string;
  }): Promise<ExecutionResult> {
    const {
      userId,
      walletId,
      positionId,
      tokenMint,
      tokenAmount,
      tokenDecimals = 9,
      slippageBps,
      priorityFeeSol,
      reason,
      tokenSymbol,
    } = params;

    const startTime = Date.now();

    // Notify immediately
    await emitToUser(userId, 'position:selling', {
      positionId,
      tokenMint,
      tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
      tokenAmount,
      reason,
      timestamp: startTime,
    });

    try {
      // 1. Get wallet and quote in parallel
      const tokenAmountRaw = Math.floor(tokenAmount * Math.pow(10, tokenDecimals));

      const [wallet, quote] = await Promise.all([
        this.getWalletKeypair(userId, walletId),
        this.getRaydiumQuote({
          inputMint: tokenMint,
          outputMint: SOL_MINT,
          amount: tokenAmountRaw,
          slippageBps,
          isBuy: false,
        }),
      ]);

      if (!wallet) {
        throw new Error('Wallet not found or decryption failed');
      }

      if (!quote) {
        throw new Error('Failed to get sell quote - no liquidity available');
      }

      const expectedSol = parseInt(quote.outputAmount) / LAMPORTS_PER_SOL;

      // Notify quote
      await emitToUser(userId, 'position:sell_quote', {
        positionId,
        tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
        expectedSol,
        priceImpact: quote.priceImpactPct,
      });

      // 2. Calculate fees (taken from received SOL)
      const platformFee = expectedSol * (this.platformFeeBps / 10000);

      // 3. Build transaction
      const swapContext: SwapContext = {
        quote,
        wallet,
        walletId,
        platformFee,
        tokenMint,
        tokenSymbol,
        userId,
        isBuy: false,
        positionId,
      };

      const transaction = await this.buildSwapTransaction(swapContext, priorityFeeSol);

      // 4. Submit with MEV protection (always on for sells)
      const result = await this.submitWithFailsafe({
        transaction,
        swapContext,
        initialTip: priorityFeeSol,
        mevProtection: true, // Always protect sells
      });

      if (result.success && result.signature) {
        // 5. Update position and record transaction (background)
        this.recordSellTransaction({
          userId,
          positionId,
          signature: result.signature,
          tokenMint,
          tokenSymbol,
          tokenAmount,
          solReceived: expectedSol,
          platformFee,
          jitoTip: priorityFeeSol,
          reason,
        }).catch(err => console.error('Failed to record sell:', err));

        // 6. Notify success
        await emitToUser(userId, 'position:sold', {
          positionId,
          signature: result.signature,
          tokenMint,
          tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
          tokenAmount,
          solReceived: expectedSol - platformFee,
          reason,
          totalLatencyMs: Date.now() - startTime,
        });

        return {
          success: true,
          signature: result.signature,
          tokenAmount,
          solReceived: expectedSol - platformFee,
          fees: {
            platformFee,
            jitoTip: priorityFeeSol,
            networkFee: 0.000005,
          },
        };
      } else {
        throw new Error(result.error || 'Sell failed after all retries');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await emitToUser(userId, 'position:sell_failed', {
        positionId,
        tokenMint,
        tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
        error: errorMessage,
        reason,
      });

      return { success: false, error: errorMessage };
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
    isBuy: boolean;
  }): Promise<RaydiumSwapResponse['data'] | null> {
    try {
      const response = await fetch('https://transaction-v1.raydium.io/compute/swap-base-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `quote-${Date.now()}`,
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount.toString(),
          slippageBps: params.slippageBps,
          txVersion: 'V0',
        }),
      });

      if (!response.ok) {
        console.error('Raydium quote error:', await response.text());
        return null;
      }

      const data: RaydiumSwapResponse = await response.json();
      if (!data.success) {
        console.error('Raydium quote failed:', data);
        return null;
      }

      return data.data;
    } catch (error) {
      console.error('Failed to get Raydium quote:', error);
      return null;
    }
  }

  /**
   * Build swap transaction using Raydium's serialized transaction
   * This is faster than building from scratch
   */
  private async buildSwapTransaction(
    context: SwapContext,
    jitoTip: number
  ): Promise<VersionedTransaction> {
    const { quote, wallet, platformFee, isBuy } = context;

    // Get serialized swap transaction from Raydium
    const txResponse = await fetch('https://transaction-v1.raydium.io/transaction/swap-base-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        computeUnitPriceMicroLamports: Math.floor((jitoTip * LAMPORTS_PER_SOL) / 400_000).toString(),
        swapResponse: quote,
        txVersion: 'V0',
        wallet: wallet.publicKey.toBase58(),
        wrapSol: isBuy, // Wrap SOL when buying
        unwrapSol: !isBuy, // Unwrap when selling
      }),
    });

    if (!txResponse.ok) {
      throw new Error(`Raydium transaction API error: ${await txResponse.text()}`);
    }

    const txData: RaydiumTxResponse = await txResponse.json();
    if (!txData.success || !txData.data?.[0]?.transaction) {
      throw new Error('Raydium returned no transaction data');
    }

    // Decode the base64 transaction
    const txBuffer = Buffer.from(txData.data[0].transaction, 'base64');
    let transaction = VersionedTransaction.deserialize(txBuffer);

    // Now we need to add our platform fee and Jito tip
    // We'll rebuild with the swap instructions + our additions
    const { blockhash, lastValidBlockHeight } = await this.getBlockhash();

    // Get the message and extract lookup tables
    const message = transaction.message;
    const lookupTableAddresses = message.addressTableLookups.map(lookup => lookup.accountKey);

    // Fetch lookup tables with caching (reduces Helius RPC calls significantly)
    let lookupTables: AddressLookupTableAccount[] = [];
    if (lookupTableAddresses.length > 0) {
      const now = Date.now();
      const uncachedAddresses: PublicKey[] = [];
      const uncachedIndices: number[] = [];

      // Check cache first
      for (let i = 0; i < lookupTableAddresses.length; i++) {
        const key = lookupTableAddresses[i].toBase58();
        const cached = this.lookupTableCache.get(key);
        if (cached && now - cached.fetchedAt < this.LOOKUP_TABLE_CACHE_MS) {
          lookupTables.push(cached.account);
        } else {
          uncachedAddresses.push(lookupTableAddresses[i]);
          uncachedIndices.push(i);
        }
      }

      // Fetch uncached lookup tables
      if (uncachedAddresses.length > 0) {
        const fetchedAccounts = await this.primaryConnection.getMultipleAccountsInfo(uncachedAddresses);
        for (let i = 0; i < fetchedAccounts.length; i++) {
          const account = fetchedAccounts[i];
          if (account) {
            const lookupTable = new AddressLookupTableAccount({
              key: uncachedAddresses[i],
              state: AddressLookupTableAccount.deserialize(account.data),
            });
            lookupTables.push(lookupTable);
            // Cache the lookup table
            this.lookupTableCache.set(uncachedAddresses[i].toBase58(), {
              account: lookupTable,
              fetchedAt: now,
            });
          }
        }
      }
    }

    // Decompile the transaction to get instructions
    const decompiledMessage = TransactionMessage.decompile(message, { addressLookupTableAccounts: lookupTables });
    const originalInstructions = decompiledMessage.instructions;

    // Build new instructions array
    const instructions: TransactionInstruction[] = [];

    // 1. Compute budget (replace Raydium's with our higher limit)
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor((jitoTip * LAMPORTS_PER_SOL) / 400_000),
    }));

    // 2. Platform fee transfer (before swap for buys, we take from input)
    if (platformFee > 0 && isBuy) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: this.platformFeeWallet,
          lamports: Math.floor(platformFee * LAMPORTS_PER_SOL),
        })
      );
    }

    // 3. Add original swap instructions (skip compute budget instructions from Raydium)
    for (const ix of originalInstructions) {
      const isComputeBudget = ix.programId.equals(ComputeBudgetProgram.programId);
      if (!isComputeBudget) {
        instructions.push(ix);
      }
    }

    // 4. Platform fee for sells (taken from output SOL)
    if (platformFee > 0 && !isBuy) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: this.platformFeeWallet,
          lamports: Math.floor(platformFee * LAMPORTS_PER_SOL),
        })
      );
    }

    // 5. Jito tip (random tip account for load distribution)
    const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: Math.floor(jitoTip * LAMPORTS_PER_SOL),
      })
    );

    // Build new versioned transaction
    const newMessage = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);

    const newTransaction = new VersionedTransaction(newMessage);
    newTransaction.sign([wallet]);

    return newTransaction;
  }

  /**
   * Submit with multi-path failsafe and parallel Jito submission
   */
  private async submitWithFailsafe(params: {
    transaction: VersionedTransaction;
    swapContext: SwapContext;
    initialTip: number;
    mevProtection: boolean;
  }): Promise<{ success: boolean; signature?: string; error?: string }> {
    const { swapContext, initialTip, mevProtection } = params;
    let { transaction } = params;
    const { userId, sniperId, tokenSymbol } = swapContext;

    // Build attempt sequence
    const attempts = mevProtection
      ? [
          { path: 'jito-parallel', tipMultiplier: 1 },      // Parallel to all Jito endpoints
          { path: 'jito-parallel', tipMultiplier: 1.5 },    // Retry with higher tip
          { path: 'helius', tipMultiplier: 2 },              // Helius staked
          { path: 'direct', tipMultiplier: 2.5 },            // Direct RPC fallback
        ]
      : [
          { path: 'helius', tipMultiplier: 1 },
          { path: 'helius', tipMultiplier: 1.5 },
          { path: 'direct', tipMultiplier: 2 },
        ];

    console.log(`   🔄 Submission strategy: ${attempts.map(a => a.path).join(' → ')}`);

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const attemptTip = initialTip * attempt.tipMultiplier;

      console.log(`   📤 Attempt ${i + 1}/${attempts.length}: ${attempt.path} (tip: ${attemptTip.toFixed(4)} SOL)`);

      // Rebuild transaction with new tip if not first attempt
      if (i > 0) {
        console.log(`      Rebuilding transaction with higher tip...`);
        await emitToUser(userId, 'snipe:retrying', {
          sniperId,
          tokenSymbol,
          attempt: i + 1,
          maxAttempts: attempts.length,
          path: attempt.path,
          newTip: attemptTip,
        });

        transaction = await this.rebuildWithNewTip(swapContext, attemptTip);
      }

      try {
        await emitToUser(userId, 'snipe:submitting', {
          sniperId,
          tokenSymbol,
          path: attempt.path,
          attempt: i + 1,
        });

        let signature: string | null = null;
        const submitStart = Date.now();

        if (attempt.path === 'jito-parallel') {
          signature = await this.submitToJitoParallel(transaction);
        } else if (attempt.path === 'helius') {
          signature = await this.submitToHelius(transaction);
        } else {
          signature = await this.submitDirect(transaction);
        }

        const submitDuration = Date.now() - submitStart;

        if (signature) {
          console.log(`      ✓ Submitted in ${submitDuration}ms, signature: ${signature.slice(0, 16)}...`);
          console.log(`      ⏳ Waiting for confirmation...`);

          // Confirm transaction
          const confirmStart = Date.now();
          const confirmed = await this.confirmTransactionFast(signature);
          const confirmDuration = Date.now() - confirmStart;

          if (confirmed) {
            console.log(`      ✅ Confirmed in ${confirmDuration}ms`);
            return { success: true, signature };
          } else {
            console.log(`      ❌ Confirmation failed/timed out after ${confirmDuration}ms`);
          }
        } else {
          console.log(`      ❌ No signature returned after ${submitDuration}ms`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.log(`      ❌ Error: ${errorMsg}`);
      }

      // Brief delay before retry (exponential backoff but capped)
      if (i < attempts.length - 1) {
        const delay = Math.min(50 * (i + 1), 150);
        console.log(`      ⏸️  Waiting ${delay}ms before retry...`);
        await this.sleep(delay);
      }
    }

    return { success: false, error: 'All submission attempts failed' };
  }

  /**
   * Submit to ALL Jito block engines in parallel - first success wins
   * Returns the transaction signature after polling for bundle confirmation
   */
  private async submitToJitoParallel(transaction: VersionedTransaction): Promise<string | null> {
    const serialized = Buffer.from(transaction.serialize()).toString('base64');

    // Get the transaction signature from the signed transaction
    // This is used to verify the bundle was included
    const txSignature = transaction.signatures[0]
      ? Buffer.from(transaction.signatures[0]).toString('base64')
      : null;

    // Submit to all Jito endpoints in parallel
    const submissions = JITO_BLOCK_ENGINES.map(async (endpoint) => {
      try {
        const response = await fetch(`${endpoint}/api/v1/bundles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [[serialized]],
          }),
        });

        const result = await response.json();
        if (result.error) {
          throw new Error(result.error.message);
        }

        return { bundleId: result.result as string, endpoint };
      } catch (error) {
        // Silent fail - other endpoints may succeed
        return null;
      }
    });

    // Wait for first successful response
    const results = await Promise.allSettled(submissions);

    let bundleId: string | null = null;
    let successEndpoint: string | null = null;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        bundleId = result.value.bundleId;
        successEndpoint = result.value.endpoint;
        break;
      }
    }

    if (!bundleId) {
      return null;
    }

    console.log(`Jito bundle submitted: ${bundleId} via ${successEndpoint}`);

    // Poll for bundle status to get the actual transaction signature
    // Jito bundles typically land within 1-2 slots (~800ms)
    const signature = await this.pollJitoBundleStatus(bundleId, successEndpoint!);

    return signature;
  }

  /**
   * Poll Jito for bundle status and return the transaction signature when confirmed
   */
  private async pollJitoBundleStatus(bundleId: string, endpoint: string): Promise<string | null> {
    const maxAttempts = 20; // ~10 seconds total
    const pollIntervalMs = 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${endpoint}/api/v1/bundles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [[bundleId]],
          }),
        });

        const result = await response.json();

        if (result.result?.value?.[0]) {
          const bundleStatus = result.result.value[0];
          const status = bundleStatus.confirmation_status;

          if (status === 'confirmed' || status === 'finalized') {
            // Bundle landed - extract transaction signatures
            const txSignatures = bundleStatus.transactions || [];
            if (txSignatures.length > 0) {
              console.log(`Jito bundle ${bundleId} confirmed with signature: ${txSignatures[0]}`);
              return txSignatures[0];
            }
          } else if (status === 'failed' || bundleStatus.err) {
            console.error(`Jito bundle ${bundleId} failed:`, bundleStatus.err);
            return null;
          }
          // Status is 'processed' or pending - keep polling
        }
      } catch (error) {
        console.error(`Error polling Jito bundle status:`, error);
      }

      await this.sleep(pollIntervalMs);
    }

    console.warn(`Jito bundle ${bundleId} status polling timed out`);
    return null;
  }

  /**
   * Submit via Helius staked connections
   */
  private async submitToHelius(transaction: VersionedTransaction): Promise<string | null> {
    try {
      const signature = await this.heliusConnection.sendTransaction(transaction, {
        skipPreflight: true, // Skip for speed
        maxRetries: 0,
      });
      return signature;
    } catch (error) {
      console.error('Helius submission error:', error);
      return null;
    }
  }

  /**
   * Submit directly to RPC
   */
  private async submitDirect(transaction: VersionedTransaction): Promise<string | null> {
    const connection = this.backupConnection || this.primaryConnection;

    try {
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: true,
        maxRetries: 2,
      });
      return signature;
    } catch (error) {
      console.error('Direct submission error:', error);
      return null;
    }
  }

  /**
   * Fast transaction confirmation with timeout
   * Uses exponential backoff to reduce RPC calls while still being responsive
   */
  private async confirmTransactionFast(signature: string): Promise<boolean> {
    const startTime = Date.now();
    const timeout = 30000; // 30 second timeout
    let pollInterval = 1000; // Start with 1 second (was 500ms)
    const maxPollInterval = 3000; // Max 3 seconds between polls

    try {
      // Poll for confirmation with exponential backoff
      while (Date.now() - startTime < timeout) {
        const status = await this.primaryConnection.getSignatureStatus(signature);

        if (status.value) {
          if (status.value.err) {
            console.error('Transaction failed:', status.value.err);
            return false;
          }

          if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
            return true;
          }
        }

        // Wait before next poll (with backoff to reduce RPC calls)
        await this.sleep(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
      }

      return false;
    } catch (error) {
      console.error('Confirmation error:', error);
      return false;
    }
  }

  /**
   * Rebuild transaction with new tip (preserves swap instructions)
   */
  private async rebuildWithNewTip(context: SwapContext, newTip: number): Promise<VersionedTransaction> {
    // Rebuild the entire transaction with new tip
    return this.buildSwapTransaction(context, newTip);
  }

  /**
   * Get wallet keypair securely
   */
  private async getWalletKeypair(userId: string, walletId: string): Promise<Keypair | null> {
    try {
      const wallet = await prisma.wallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet || wallet.walletType !== 'generated') {
        return null;
      }

      const encrypted: EncryptedKey = {
        ciphertext: wallet.encryptedPrivateKey || '',
        iv: wallet.iv || '',
        authTag: wallet.authTag || '',
        version: 1,
      };

      const privateKey = await this.secureWallet.decryptPrivateKey(encrypted, userId);
      const keypair = Keypair.fromSecretKey(privateKey);

      // Zero out private key
      privateKey.fill(0);

      return keypair;
    } catch (error) {
      console.error('Failed to get wallet keypair:', error);
      return null;
    }
  }

  /**
   * Record buy transaction in database
   */
  private async recordTransaction(params: {
    userId: string;
    walletId: string;
    sniperId?: string;
    signature: string;
    tokenMint: string;
    tokenSymbol?: string;
    solAmount: number;
    tokenAmount: number;
    platformFee: number;
    jitoTip: number;
    txType: 'buy' | 'sell';
  }): Promise<void> {
    const { userId, walletId, sniperId, signature, tokenMint, tokenSymbol, solAmount, tokenAmount, platformFee, jitoTip } = params;

    // Create position record
    const position = await prisma.position.create({
      data: {
        userId,
        walletId,
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
        eventData: { signature, tokenMint, tokenSymbol, solAmount, tokenAmount, platformFee, jitoTip },
      },
    });
  }

  /**
   * Record sell transaction
   */
  private async recordSellTransaction(params: {
    userId: string;
    positionId: string;
    signature: string;
    tokenMint: string;
    tokenSymbol?: string;
    tokenAmount: number;
    solReceived: number;
    platformFee: number;
    jitoTip: number;
    reason: string;
  }): Promise<void> {
    const { userId, positionId, signature, tokenMint, tokenSymbol, tokenAmount, solReceived, platformFee, jitoTip, reason } = params;

    // Update position to closed
    const position = await prisma.position.update({
      where: { id: positionId },
      data: {
        status: 'closed',
        exitSol: solReceived,
        exitPrice: solReceived / tokenAmount,
        currentTokenAmount: 0,
        closedAt: new Date(),
      },
    });

    // Create sell transaction record
    await prisma.transaction.create({
      data: {
        userId,
        positionId,
        signature,
        txType: 'sell',
        solAmount: solReceived,
        tokenAmount,
        platformFee,
        jitoTip,
        status: 'confirmed',
      },
    });

    // Record fee
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
        sniperId: position.sniperId,
        eventType: `position:${reason}`,
        eventData: { signature, tokenMint, tokenSymbol, tokenAmount, solReceived, platformFee },
      },
    });
  }

  /**
   * Get current token price from Jupiter (more reliable than Raydium for new tokens)
   */
  async getTokenPrice(tokenMint: string): Promise<number | null> {
    try {
      // Try Jupiter first (better for new tokens)
      const jupiterResponse = await fetch(
        `https://price.jup.ag/v6/price?ids=${tokenMint}`
      );

      if (jupiterResponse.ok) {
        const data = await jupiterResponse.json();
        if (data.data?.[tokenMint]?.price) {
          return data.data[tokenMint].price;
        }
      }

      // Fallback to Raydium
      const raydiumResponse = await fetch(
        `https://api.raydium.io/v2/main/price?tokens=${tokenMint}`
      );

      if (raydiumResponse.ok) {
        const data = await raydiumResponse.json();
        return data.data?.[tokenMint] || null;
      }

      return null;
    } catch (error) {
      console.error('Failed to get token price:', error);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get executor status for admin dashboard
   */
  getStatus(): {
    rpcConnections: {
      primary: boolean;
      helius: boolean;
      backup: boolean;
    };
    jitoEndpoints: string[];
    mevProtection: boolean;
    blockhashCacheAge: number | null;
    platformFeeWallet: string;
    platformFeeBps: number;
  } {
    return {
      rpcConnections: {
        primary: !!this.primaryConnection,
        helius: !!this.heliusConnection,
        backup: !!this.backupConnection,
      },
      jitoEndpoints: JITO_BLOCK_ENGINES,
      mevProtection: true,
      blockhashCacheAge: this.cachedBlockhash
        ? Date.now() - this.cachedBlockhash.fetchedAt
        : null,
      platformFeeWallet: this.platformFeeWallet.toBase58(),
      platformFeeBps: this.platformFeeBps,
    };
  }
}

// Singleton instance
export const transactionExecutor = new TransactionExecutor();
