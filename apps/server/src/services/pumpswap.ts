import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import { rpcCircuitBreaker } from '../utils/circuit-breaker.js';

// PumpSwap AMM Program ID
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Protocol fee program (pfee)
const PFEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');

// PumpSwap constants
const GLOBAL_AUTHORITY = new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
// Protocol fee recipient - updated to current address as of Jan 2026
// Old address was 62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV
const FEE_RECEIVER = new PublicKey('7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX');
const EVENT_AUTHORITY = new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR');

// Global volume accumulator PDA - used for volume tracking
const [GLOBAL_VOLUME_ACCUMULATOR] = PublicKey.findProgramAddressSync(
  [Buffer.from('global_volume_accumulator')],
  PUMP_AMM_PROGRAM_ID
);

// Fee config PDA - required for all buy/sell transactions
const [FEE_CONFIG] = PublicKey.findProgramAddressSync(
  [Buffer.from('fee_config'), PUMP_AMM_PROGRAM_ID.toBuffer()],
  PFEE_PROGRAM
);

// Pump tokens use Token-2022 program
const PUMP_TOKEN_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;

// Instruction discriminators (8 bytes each)
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

export interface PumpSwapQuote {
  tokenMint: string;
  poolAddress: string;
  tokenReserve: bigint;
  solReserve: bigint;
  expectedTokens: bigint;
  minTokensOut: bigint;
  maxSolSpend: bigint;
  priceImpactPct: number;
  // Vault addresses read from pool account data (NOT derived ATAs)
  baseVault: string;
  quoteVault: string;
  // Coin creator from pool data - used for creator fee distribution
  coinCreator: string;
  // Token program ID - can be Token or Token-2022
  tokenProgramId: string;
}

export interface PumpSwapSellQuote {
  tokenMint: string;
  poolAddress: string;
  tokenReserve: bigint;
  solReserve: bigint;
  expectedSol: bigint;
  minSolOut: bigint;
  tokenAmount: bigint;
  priceImpactPct: number;
  // Vault addresses read from pool account data (NOT derived ATAs)
  baseVault: string;
  quoteVault: string;
  // Coin creator from pool data - used for creator fee distribution
  coinCreator: string;
  // Token program ID - can be Token or Token-2022
  tokenProgramId: string;
}

/**
 * PumpSwap Service - Handles swaps on PumpSwap AMM (pump-amm pools)
 *
 * This is used for tokens that migrated to PumpSwap instead of Raydium.
 * PumpSwap uses a constant-product AMM (x * y = k)
 */
export class PumpSwapService {
  private connection: Connection;
  private poolCache = new Map<string, { pool: PublicKey; reserves?: { tokenReserve: bigint; solReserve: bigint; baseVault: PublicKey; quoteVault: PublicKey }; fetchedAt: number }>();
  private tokenProgramCache = new Map<string, PublicKey>(); // Cache token program IDs
  // Cache coinCreator per token - this value NEVER changes, so cache indefinitely
  // This avoids fetching 20 transactions for every sell of the same token
  private coinCreatorCache = new Map<string, string>();
  private readonly POOL_CACHE_MS = 5000; // 5 second cache for pool data

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Get cached coinCreator or null if not cached
   */
  getCachedCoinCreator(tokenMint: string): string | null {
    return this.coinCreatorCache.get(tokenMint) || null;
  }

  /**
   * Cache coinCreator for a token (called after successful fetch)
   */
  setCachedCoinCreator(tokenMint: string, coinCreator: string): void {
    this.coinCreatorCache.set(tokenMint, coinCreator);
    console.log(`   [PumpSwap] Cached coinCreator for ${tokenMint.slice(0, 8)}...`);
  }

  /**
   * Detect which token program owns a mint (Token or Token-2022)
   * CRITICAL: Not all pump tokens use Token-2022, some use the standard Token program
   */
  async getTokenProgram(tokenMint: PublicKey): Promise<PublicKey> {
    const cacheKey = tokenMint.toBase58();
    const cached = this.tokenProgramCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const mintInfo = await this.connection.getAccountInfo(tokenMint);
    if (!mintInfo) {
      throw new Error(`Token mint not found: ${tokenMint.toBase58()}`);
    }

    const tokenProgram = mintInfo.owner;
    this.tokenProgramCache.set(cacheKey, tokenProgram);

    // Log which program is being used for debugging
    const isToken2022 = tokenProgram.equals(TOKEN_2022_PROGRAM_ID);
    console.log(`   [PumpSwap] Token ${tokenMint.toBase58().slice(0, 8)}... uses ${isToken2022 ? 'Token-2022' : 'Token'} program`);

    return tokenProgram;
  }

  /**
   * Find the PumpSwap pool for a token with retry logic
   * Newly migrated pools may not be indexed immediately by the RPC
   */
  async findPool(tokenMint: PublicKey, retryCount = 3, retryDelayMs = 500): Promise<PublicKey | null> {
    const cacheKey = tokenMint.toBase58();
    const cached = this.poolCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < this.POOL_CACHE_MS) {
      return cached.pool;
    }

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        // Search for pool accounts matching this token
        // Pool account size is 301 bytes (not 211 - that was incorrect)
        const filters = [
          { dataSize: 301 }, // Pool account size (verified Jan 2026)
          { memcmp: { offset: 43, bytes: tokenMint.toBase58() } }, // Token mint at offset 43
          { memcmp: { offset: 75, bytes: WSOL_MINT.toBase58() } }, // WSOL at offset 75
        ];

        const accounts = await this.connection.getProgramAccounts(PUMP_AMM_PROGRAM_ID, { filters });

        if (accounts.length > 0) {
          const pool = accounts[0].pubkey;
          // Cache the result
          this.poolCache.set(cacheKey, { pool, fetchedAt: Date.now() });
          console.log(`   [PumpSwap] Found pool: ${pool.toBase58().slice(0, 12)}... (attempt ${attempt})`);
          return pool;
        }

        if (attempt < retryCount) {
          const delay = retryDelayMs * attempt; // Progressive delay: 500ms, 1000ms, 1500ms
          console.log(`   [PumpSwap] Pool not indexed yet, waiting ${delay}ms before retry ${attempt + 1}/${retryCount}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        // Check for rate limiting / deprioritization
        const isRateLimited = errMsg.includes('deprioritized') || errMsg.includes('Request deprioritized');

        if (isRateLimited) {
          console.warn(`   [PumpSwap] Rate limited on attempt ${attempt}, waiting longer before retry...`);
          // Wait longer for rate limiting (2s, 4s, 6s)
          if (attempt < retryCount) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          }
        } else {
          console.error(`   [PumpSwap] Error finding pool (attempt ${attempt}): ${errMsg}`);
          if (attempt < retryCount) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
          }
        }
      }
    }

    console.log(`   [PumpSwap] No pool found for token ${tokenMint.toBase58().slice(0, 12)}... after ${retryCount} attempts`);
    return null;
  }

  /**
   * Parse pool account data to extract vault addresses
   * PumpSwap pool structure (301 bytes):
   * - offset 43: base token mint (32 bytes)
   * - offset 75: quote mint / WSOL (32 bytes)
   * - offset 107: LP mint (32 bytes)
   * - offset 139: base token vault (32 bytes) <-- Token-2022 vault
   * - offset 171: quote token vault (32 bytes) <-- WSOL vault
   * - offset 203: LP vault (32 bytes)
   * - offset 235: NOT reliable for coinCreator! Use fetchCoinCreator() instead
   *
   * CRITICAL: PumpSwap does NOT use standard ATAs!
   * Vault addresses are stored directly in pool account data
   */
  parsePoolData(data: Buffer): { baseTokenVault: PublicKey; quoteTokenVault: PublicKey } {
    const baseTokenVault = new PublicKey(data.slice(139, 171));
    const quoteTokenVault = new PublicKey(data.slice(171, 203));
    return { baseTokenVault, quoteTokenVault };
  }

  /**
   * Fetch the coinCreator from recent pool transactions
   * The coinCreator is at account index [18] in PumpSwap AMM swap/buy/sell instructions
   *
   * This is necessary because:
   * 1. Pool data at offset 235 does NOT contain the correct coinCreator
   * 2. Helius enhanced API doesn't always include AMM instructions for migration events
   *
   * Strategy:
   * 1. Check top-level instructions for PumpSwap AMM calls
   * 2. Also check inner instructions (for CPI calls through aggregators)
   * 3. Look at more transactions if needed (up to 20)
   */
  async fetchCoinCreator(pool: PublicKey): Promise<PublicKey | null> {
    try {
      // Get recent transactions for this pool - check more for better coverage
      const sigs = await this.connection.getSignaturesForAddress(pool, { limit: 20 });
      console.log(`   [PumpSwap] Checking ${sigs.length} transactions for coinCreator...`);

      const targetPoolStr = pool.toBase58();

      for (const sig of sigs) {
        try {
          const tx = await this.connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
          if (!tx?.transaction?.message?.instructions) continue;

          // First, check top-level instructions for PumpSwap AMM calls
          for (const ix of tx.transaction.message.instructions) {
            if ('programId' in ix && ix.programId?.toString() === PUMP_AMM_PROGRAM_ID.toBase58()) {
              const accounts = (ix as any).accounts || [];
              // coinCreator is at index 18 in buy/sell/swap instructions (21+ accounts)
              // CRITICAL: accounts[0] is the pool - must verify it's OUR pool
              if (accounts.length >= 19) {
                const instructionPool = accounts[0]?.toString();
                if (instructionPool !== targetPoolStr) {
                  // This instruction is for a different pool (e.g., in a multi-hop Jupiter swap)
                  continue;
                }
                const coinCreator = accounts[18];
                if (coinCreator && typeof coinCreator.toString === 'function') {
                  const creatorPubkey = new PublicKey(coinCreator.toString());
                  console.log(`   [PumpSwap] Fetched coinCreator from top-level tx: ${creatorPubkey.toBase58().slice(0, 12)}...`);
                  return creatorPubkey;
                }
              }
            }
          }

          // Also check inner instructions (for CPI calls through aggregators like Jupiter)
          const innerInstructions = tx.meta?.innerInstructions || [];
          for (const inner of innerInstructions) {
            for (const ix of inner.instructions) {
              if ('programId' in ix && ix.programId?.toString() === PUMP_AMM_PROGRAM_ID.toBase58()) {
                const accounts = (ix as any).accounts || [];
                // CRITICAL: accounts[0] is the pool - must verify it's OUR pool
                if (accounts.length >= 19) {
                  const instructionPool = accounts[0]?.toString();
                  if (instructionPool !== targetPoolStr) {
                    // This instruction is for a different pool
                    continue;
                  }
                  const coinCreator = accounts[18];
                  if (coinCreator && typeof coinCreator.toString === 'function') {
                    const creatorPubkey = new PublicKey(coinCreator.toString());
                    console.log(`   [PumpSwap] Fetched coinCreator from inner tx: ${creatorPubkey.toBase58().slice(0, 12)}...`);
                    return creatorPubkey;
                  }
                }
              }
            }
          }
        } catch (txError) {
          // Skip individual transaction errors and continue checking others
          console.log(`   [PumpSwap] Error parsing tx ${sig.signature.slice(0, 12)}..., skipping`);
          continue;
        }
      }

      console.log(`   [PumpSwap] Could not find coinCreator in ${sigs.length} pool transactions`);
      return null;
    } catch (error) {
      console.error(`   [PumpSwap] Error fetching coinCreator:`, error);
      return null;
    }
  }

  /**
   * Get pool reserves with retry logic for newly created pools
   * New pools may not be indexed immediately by the RPC
   *
   * CRITICAL: Reads vault addresses from pool account data, NOT derived ATAs
   * PumpSwap uses non-standard vault addresses that must be parsed from on-chain data
   *
   * Retry strategy: aggressive initial retries, then back off heavily
   * - Retries at: 100ms, 200ms, 400ms, 800ms, 2s, 5s, 10s, 15s, 20s
   * - Most accounts index within 100-500ms
   * - Extended retries for edge cases where RPC indexing is slow
   * - Total wait time: ~53 seconds if all retries needed
   */
  async getReserves(
    pool: PublicKey,
    tokenMint: PublicKey,
    retryCount = 9
  ): Promise<{ tokenReserve: bigint; solReserve: bigint; baseVault: PublicKey; quoteVault: PublicKey }> {
    // Circuit breaker check - fail fast if RPC is having issues
    if (!rpcCircuitBreaker.canRequest()) {
      throw new Error('RPC circuit breaker is OPEN - service temporarily unavailable');
    }

    // Aggressive initial delays, then heavy backoff for slow RPC indexing
    const retryDelays = [100, 200, 400, 800, 2000, 5000, 10000, 15000, 20000];

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        // First, fetch pool account to get vault addresses
        const poolInfo = await this.connection.getAccountInfo(pool);
        if (!poolInfo) {
          throw new Error('Pool account not found');
        }

        // Parse vault addresses from pool data (coinCreator is NOT reliable from pool data!)
        const { baseTokenVault, quoteTokenVault } = this.parsePoolData(poolInfo.data);

        // Fetch balances from the actual vault addresses
        const [tokenBal, wsolBal] = await Promise.all([
          this.connection.getTokenAccountBalance(baseTokenVault),
          this.connection.getTokenAccountBalance(quoteTokenVault),
        ]);

        if (attempt > 1) {
          console.log(`   [PumpSwap] ✓ Reserves fetched on attempt ${attempt}`);
        }

        // Record success with circuit breaker
        rpcCircuitBreaker.recordSuccess();

        return {
          tokenReserve: BigInt(tokenBal.value.amount),
          solReserve: BigInt(wsolBal.value.amount),
          baseVault: baseTokenVault,
          quoteVault: quoteTokenVault,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isNotFound = errorMsg.includes('could not find account') || errorMsg.includes('Invalid param') || errorMsg.includes('Pool account not found');
        const isRpcError = errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('timeout') || errorMsg.includes('503');

        // Record failure with circuit breaker for RPC-level errors (not "account not found")
        if (isRpcError) {
          rpcCircuitBreaker.recordFailure();
        }

        if (attempt < retryCount) {
          const delay = retryDelays[attempt - 1] || 2000;
          if (isNotFound) {
            console.log(`   [PumpSwap] Pool not indexed yet (attempt ${attempt}/${retryCount}), waiting ${delay}ms...`);
          } else {
            console.log(`   [PumpSwap] getReserves attempt ${attempt}/${retryCount} failed: ${errorMsg.slice(0, 60)}`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`   [PumpSwap] ✗ Failed to get reserves after ${retryCount} attempts`);
          throw error;
        }
      }
    }

    // Should never reach here, but TypeScript needs this
    throw new Error('Failed to get reserves after all retries');
  }

  /**
   * Calculate buy quote - how many tokens for X SOL
   * @param knownPoolAddress - If provided, skip pool discovery (faster for new migrations)
   * @param knownCoinCreator - If provided, use this instead of reading from pool data (CRITICAL for PumpSwap)
   */
  async getBuyQuote(
    tokenMint: string,
    solAmount: number,
    slippageBps: number,
    knownPoolAddress?: string,
    knownCoinCreator?: string
  ): Promise<PumpSwapQuote | null> {
    const mint = new PublicKey(tokenMint);

    // Use provided pool address if available, otherwise discover it
    let pool: PublicKey | null = null;

    // Validate the known pool address - must be a valid base58 Solana address (32-44 chars)
    // PumpPortal sometimes returns "pump-amm" which is not a valid address
    const isValidPoolAddress = knownPoolAddress &&
      knownPoolAddress.length >= 32 &&
      knownPoolAddress.length <= 44 &&
      !knownPoolAddress.includes('-');

    if (isValidPoolAddress) {
      try {
        pool = new PublicKey(knownPoolAddress);
        console.log(`   [PumpSwap] Using known pool address: ${pool.toBase58().slice(0, 12)}...`);
      } catch (err) {
        console.warn(`   [PumpSwap] Invalid pool address provided (${knownPoolAddress}), falling back to discovery`);
        pool = await this.findPool(mint);
      }
    } else {
      if (knownPoolAddress) {
        console.log(`   [PumpSwap] Pool address "${knownPoolAddress}" is not a valid Solana address, discovering...`);
      }
      pool = await this.findPool(mint);
    }

    if (!pool) {
      return null;
    }

    const reserves = await this.getReserves(pool, mint);
    const { tokenReserve, solReserve } = reserves;

    // Detect which token program this mint uses (Token or Token-2022)
    const tokenProgram = await this.getTokenProgram(mint);

    // Cache for later
    this.poolCache.set(tokenMint, { pool, reserves, fetchedAt: Date.now() });

    // Constant product: x * y = k
    // newSolReserve = solReserve + solIn
    // newTokenReserve = k / newSolReserve
    // tokenOut = tokenReserve - newTokenReserve
    const solLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
    const product = solReserve * tokenReserve;
    const newSolReserve = solReserve + solLamports;
    const newTokenReserve = product / newSolReserve;
    const tokenOut = tokenReserve - newTokenReserve;

    // PumpSwap AMM "buy" instruction behavior (IMPORTANT - differs from typical AMMs!):
    // The AMM operates as "exact output" style:
    // 1. It takes minTokensOut and calculates minimum SOL needed to get that many tokens
    // 2. If that SOL amount <= maxSolSpend, it executes and spends EXACTLY that SOL amount
    // 3. If that SOL amount > maxSolSpend, it fails
    //
    // This means: minTokensOut directly determines how much SOL is spent!
    // If minTokensOut = 85% of expected, only ~85% of maxSolSpend is used.
    //
    // For "fixed input" buys where user wants to spend their FULL SOL amount:
    // - We need minTokensOut close to expectedTokens (100%)
    // - But allow small tolerance for block-to-block price movement
    //
    // We use 5% execution tolerance (not user's slippage which may be 15-20%):
    // - Ensures ~95% of intended SOL is spent
    // - Allows for some price volatility during transaction confirmation
    // - If price moved >5% against us, transaction fails (better than overpaying)
    //
    // User's configured slippage is effectively ignored for buy amount, but maxSolSpend
    // still acts as a ceiling to protect against extreme price spikes.
    const EXECUTION_TOLERANCE_BPS = 500; // 5% tolerance for price movement during execution
    const minTokensOut = tokenOut * BigInt(10000 - EXECUTION_TOLERANCE_BPS) / 10000n;

    // maxSolSpend is the EXACT amount user wants to spend - no inflation
    const maxSolSpend = solLamports;

    // Calculate price impact
    const priceImpactPct = Number((solLamports * 10000n) / solReserve) / 100;

    console.log(`   [PumpSwap] Buy quote: ${solAmount} SOL → ${Number(tokenOut) / 1e6} tokens (expected)`);
    console.log(`   [PumpSwap] minTokensOut: ${Number(minTokensOut) / 1e6} tokens (${EXECUTION_TOLERANCE_BPS/100}% tolerance)`);
    console.log(`   [PumpSwap] maxSolSpend: ${Number(maxSolSpend) / 1e9} SOL (exact)`);
    console.log(`   [PumpSwap] Reserves: ${Number(solReserve) / 1e9} SOL / ${Number(tokenReserve) / 1e6} tokens`);
    console.log(`   [PumpSwap] Price impact: ${priceImpactPct.toFixed(2)}%`);

    // Get coinCreator - check cache, then provided value, then fetch from transactions
    // CRITICAL: Pool data at offset 235 does NOT contain the actual creator for most tokens
    // The correct creator comes from the migration transaction at account index 18
    let finalCoinCreator: string;

    // Check cache first (coinCreator never changes for a token)
    const cachedCreator = this.getCachedCoinCreator(tokenMint);
    if (cachedCreator) {
      finalCoinCreator = cachedCreator;
      console.log(`   [PumpSwap] Using cached coinCreator: ${cachedCreator.slice(0, 12)}... (fast path)`);
    } else if (knownCoinCreator) {
      finalCoinCreator = knownCoinCreator;
      // Cache for future sells
      this.setCachedCoinCreator(tokenMint, knownCoinCreator);
      console.log(`   [PumpSwap] Using coinCreator from migration event: ${knownCoinCreator.slice(0, 12)}...`);
    } else {
      // Fallback: fetch coinCreator from pool's recent transactions
      console.log(`   [PumpSwap] No coinCreator provided, fetching from pool transactions...`);
      const fetchedCreator = await this.fetchCoinCreator(pool);
      if (fetchedCreator) {
        finalCoinCreator = fetchedCreator.toBase58();
        // Cache for future sells
        this.setCachedCoinCreator(tokenMint, finalCoinCreator);
        console.log(`   [PumpSwap] Using fetched coinCreator: ${finalCoinCreator.slice(0, 12)}...`);
      } else {
        // Last resort: this will likely fail with error 2006, but at least log the issue
        console.error(`   [PumpSwap] ⚠️ WARNING: Could not determine coinCreator! Transaction will likely fail.`);
        throw new Error('Unable to determine coinCreator for PumpSwap transaction. Please retry or provide token manually.');
      }
    }

    return {
      tokenMint,
      poolAddress: pool.toBase58(),
      tokenReserve,
      solReserve,
      expectedTokens: tokenOut,
      minTokensOut,
      maxSolSpend,
      priceImpactPct,
      baseVault: reserves.baseVault.toBase58(),
      quoteVault: reserves.quoteVault.toBase58(),
      coinCreator: finalCoinCreator,
      tokenProgramId: tokenProgram.toBase58(),
    };
  }

  /**
   * Calculate sell quote - how much SOL for X tokens
   * Optimized with parallel fetching for speed
   */
  async getSellQuote(
    tokenMint: string,
    tokenAmount: bigint,
    slippageBps: number
  ): Promise<PumpSwapSellQuote | null> {
    const quoteStart = Date.now();
    const mint = new PublicKey(tokenMint);

    // OPTIMIZATION: Fetch pool and token program in parallel
    const [pool, tokenProgram] = await Promise.all([
      this.findPool(mint),
      this.getTokenProgram(mint),
    ]);

    if (!pool) {
      return null;
    }

    // Get reserves (depends on pool, so can't parallelize with findPool)
    const reserves = await this.getReserves(pool, mint);
    const { tokenReserve, solReserve } = reserves;

    console.log(`   [PumpSwap] Quote fetch took ${Date.now() - quoteStart}ms`);

    // Constant product: x * y = k
    // newTokenReserve = tokenReserve + tokenIn
    // newSolReserve = k / newTokenReserve
    // solOut = solReserve - newSolReserve
    const product = solReserve * tokenReserve;
    const newTokenReserve = tokenReserve + tokenAmount;
    const newSolReserve = product / newTokenReserve;
    const solOut = solReserve - newSolReserve;

    // Apply slippage to get minimum SOL out
    const minSolOut = solOut * BigInt(10000 - slippageBps) / 10000n;

    // Calculate price impact
    const priceImpactPct = Number((tokenAmount * 10000n) / tokenReserve) / 100;

    console.log(`   [PumpSwap] Sell quote: ${Number(tokenAmount) / 1e6} tokens → ${Number(solOut) / 1e9} SOL`);
    console.log(`   [PumpSwap] Price impact: ${priceImpactPct.toFixed(2)}%`);

    // Get coinCreator - check cache first for speed, then fetch from transactions
    // CRITICAL: Pool data at offset 235 does NOT contain the correct coinCreator!
    // We MUST get it from actual transaction history where account[18] has the creator
    let coinCreator: string;

    // Check cache first (coinCreator never changes for a token)
    const cachedCreator = this.getCachedCoinCreator(tokenMint);
    if (cachedCreator) {
      coinCreator = cachedCreator;
      console.log(`   [PumpSwap] Using cached coinCreator: ${coinCreator.slice(0, 12)}... (fast path)`);
    } else {
      console.log(`   [PumpSwap] Fetching coinCreator from transactions...`);
      const fetchedCreator = await this.fetchCoinCreator(pool);
      if (fetchedCreator) {
        coinCreator = fetchedCreator.toBase58();
        // Cache for future sells of this token
        this.setCachedCoinCreator(tokenMint, coinCreator);
        console.log(`   [PumpSwap] Using fetched coinCreator: ${coinCreator.slice(0, 12)}...`);
      } else {
        // Pool data offset 235 gives WRONG values - do NOT use it as fallback!
        // This was causing ConstraintSeeds errors with coin_creator_vault_authority
        console.error(`   [PumpSwap] ⚠️ Could not fetch coinCreator from pool transactions`);
        console.error(`   [PumpSwap] Pool: ${pool.toBase58()}`);
        console.error(`   [PumpSwap] Token: ${tokenMint}`);
        throw new Error('Unable to determine coinCreator for PumpSwap sell. Pool may be too new or transactions unavailable. Please try again in a moment.');
      }
    }

    return {
      tokenMint,
      poolAddress: pool.toBase58(),
      tokenReserve,
      solReserve,
      expectedSol: solOut,
      minSolOut,
      tokenAmount,
      priceImpactPct,
      baseVault: reserves.baseVault.toBase58(),
      quoteVault: reserves.quoteVault.toBase58(),
      coinCreator,
      tokenProgramId: tokenProgram.toBase58(),
    };
  }

  /**
   * Build buy instruction for PumpSwap
   * IMPORTANT: Pump tokens use Token-2022 program, WSOL uses regular Token program
   * CRITICAL: Pool vault addresses come from quote (parsed from pool account data), NOT derived ATAs
   *
   * PumpSwap buy instruction requires 23 accounts (as of late 2024):
   * [0-16] Standard accounts
   * [17] coin_creator_vault_ata - WSOL ATA for creator fee distribution
   * [18] coin_creator_vault_authority - Coin creator from pool data
   * [19] global_volume_accumulator - Global volume tracking PDA
   * [20] user_volume_accumulator - User-specific volume tracking PDA
   * [21] fee_config - Protocol fee config PDA
   * [22] fee_program - Protocol fee program (pfee)
   */
  async buildBuyInstruction(
    wallet: Keypair,
    quote: PumpSwapQuote
  ): Promise<{ instructions: TransactionInstruction[]; cleanupInstructions: TransactionInstruction[] }> {
    const pool = new PublicKey(quote.poolAddress);
    const tokenMint = new PublicKey(quote.tokenMint);
    const coinCreator = new PublicKey(quote.coinCreator);
    // CRITICAL: Use the token program detected during quote - can be Token or Token-2022
    const tokenProgramId = new PublicKey(quote.tokenProgramId);

    // User ATAs are still derived normally - but use the correct token program!
    const userTokenATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey, false, tokenProgramId);
    const userWsolATA = getAssociatedTokenAddressSync(WSOL_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);

    // CRITICAL: Use vault addresses from quote (parsed from pool account), NOT derived ATAs
    // PumpSwap uses non-standard vault addresses stored in pool account data
    const poolTokenATA = new PublicKey(quote.baseVault);
    const poolWsolATA = new PublicKey(quote.quoteVault);

    const feeATA = getAssociatedTokenAddressSync(WSOL_MINT, FEE_RECEIVER, true, TOKEN_PROGRAM_ID);

    // Coin creator's WSOL ATA for creator fee distribution
    const coinCreatorVaultATA = getAssociatedTokenAddressSync(WSOL_MINT, coinCreator, true, TOKEN_PROGRAM_ID);

    // User volume accumulator PDA
    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_volume_accumulator'), wallet.publicKey.toBuffer()],
      PUMP_AMM_PROGRAM_ID
    );

    const instructions: TransactionInstruction[] = [];
    const cleanupInstructions: TransactionInstruction[] = [];

    // Check if user token ATA exists (uses detected token program - can be Token or Token-2022)
    const tokenAccInfo = await this.connection.getAccountInfo(userTokenATA);
    if (!tokenAccInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userTokenATA,
          wallet.publicKey,
          tokenMint,
          tokenProgramId // Use the correct token program for this mint
        )
      );
    }

    // Check if user WSOL ATA exists and has enough balance (regular Token program)
    const wsolAccInfo = await this.connection.getAccountInfo(userWsolATA);
    let currentWsolBalance = 0n;

    if (!wsolAccInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userWsolATA,
          wallet.publicKey,
          WSOL_MINT,
          TOKEN_PROGRAM_ID // Regular Token program for WSOL
        )
      );
    } else {
      try {
        const balanceInfo = await this.connection.getTokenAccountBalance(userWsolATA);
        currentWsolBalance = BigInt(balanceInfo.value.amount);
      } catch {
        // Account might be empty
      }
    }

    // Wrap SOL if needed
    if (currentWsolBalance < quote.maxSolSpend) {
      const wrapAmount = quote.maxSolSpend - currentWsolBalance;
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: userWsolATA,
          lamports: wrapAmount,
        }),
        createSyncNativeInstruction(userWsolATA)
      );
    }

    // Build buy instruction data
    const data = Buffer.alloc(24);
    BUY_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(quote.minTokensOut, 8);
    data.writeBigUInt64LE(quote.maxSolSpend, 16);

    // Build buy instruction with all 23 required accounts
    // PumpSwap uses the detected token program (Token or Token-2022) for base token, Token for WSOL
    const buyInstruction = new TransactionInstruction({
      programId: PUMP_AMM_PROGRAM_ID,
      keys: [
        // [0-16] Standard accounts
        { pubkey: pool, isSigner: false, isWritable: true },                      // [0] pool
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },           // [1] user
        { pubkey: GLOBAL_AUTHORITY, isSigner: false, isWritable: false },         // [2] global_config
        { pubkey: tokenMint, isSigner: false, isWritable: false },                // [3] base_mint
        { pubkey: WSOL_MINT, isSigner: false, isWritable: false },                // [4] quote_mint
        { pubkey: userTokenATA, isSigner: false, isWritable: true },              // [5] user_base_token_account
        { pubkey: userWsolATA, isSigner: false, isWritable: true },               // [6] user_quote_token_account
        { pubkey: poolTokenATA, isSigner: false, isWritable: true },              // [7] pool_base_token_account
        { pubkey: poolWsolATA, isSigner: false, isWritable: true },               // [8] pool_quote_token_account
        { pubkey: FEE_RECEIVER, isSigner: false, isWritable: false },             // [9] protocol_fee_recipient
        { pubkey: feeATA, isSigner: false, isWritable: true },                    // [10] protocol_fee_recipient_token_account
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },           // [11] base_token_program (Token or Token-2022)
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },         // [12] quote_token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },  // [13] system_program
        { pubkey: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), isSigner: false, isWritable: false }, // [14] associated_token_program
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },          // [15] event_authority
        { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },      // [16] program
        // [17-22] Additional required accounts (added in late 2024)
        { pubkey: coinCreatorVaultATA, isSigner: false, isWritable: true },       // [17] coin_creator_vault_ata
        { pubkey: coinCreator, isSigner: false, isWritable: false },              // [18] coin_creator_vault_authority
        { pubkey: GLOBAL_VOLUME_ACCUMULATOR, isSigner: false, isWritable: false },// [19] global_volume_accumulator
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },     // [20] user_volume_accumulator
        { pubkey: FEE_CONFIG, isSigner: false, isWritable: false },               // [21] fee_config
        { pubkey: PFEE_PROGRAM, isSigner: false, isWritable: false },             // [22] fee_program
      ],
      data,
    });

    instructions.push(buyInstruction);

    // Cleanup: close WSOL account to recover rent
    cleanupInstructions.push(
      createCloseAccountInstruction(
        userWsolATA,
        wallet.publicKey,
        wallet.publicKey
      )
    );

    return { instructions, cleanupInstructions };
  }

  /**
   * Build sell instruction for PumpSwap
   * IMPORTANT: Pump tokens use Token-2022 program, WSOL uses regular Token program
   * CRITICAL: Pool vault addresses come from quote (parsed from pool account data), NOT derived ATAs
   *
   * PumpSwap sell instruction requires 21 accounts (NOT 23 like buy!):
   * [0] pool
   * [1] user
   * [2] global_config
   * [3] base_mint (token) - same order as buy!
   * [4] quote_mint (WSOL)
   * [5] user_base_token_account (token)
   * [6] user_quote_token_account (WSOL)
   * [7] pool_base_token_account (token vault)
   * [8] pool_quote_token_account (WSOL vault)
   * [9] protocol_fee_recipient
   * [10] protocol_fee_recipient_token_account (WSOL ATA)
   * [11] base_token_program (Token or Token-2022)
   * [12] quote_token_program (Token)
   * [13] system_program
   * [14] associated_token_program
   * [15] event_authority
   * [16] program (self-reference)
   * [17] coin_creator_vault_ata - WSOL ATA for creator fee distribution
   * [18] coin_creator - coin creator authority
   * [19] fee_config - Protocol fee config PDA (owned by PFEE program)
   * [20] fee_program - Protocol fee program (pfee)
   *
   * NOTE: Sell does NOT include volume accumulators like buy does!
   */
  async buildSellInstruction(
    wallet: Keypair,
    quote: PumpSwapSellQuote
  ): Promise<{ instructions: TransactionInstruction[]; cleanupInstructions: TransactionInstruction[] }> {
    const pool = new PublicKey(quote.poolAddress);
    const tokenMint = new PublicKey(quote.tokenMint);
    const coinCreator = new PublicKey(quote.coinCreator);
    // CRITICAL: Use the token program detected during quote - can be Token or Token-2022
    const tokenProgramId = new PublicKey(quote.tokenProgramId);

    // User ATAs are still derived normally - but use the correct token program!
    const userTokenATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey, false, tokenProgramId);
    const userWsolATA = getAssociatedTokenAddressSync(WSOL_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);

    // CRITICAL: Use vault addresses from quote (parsed from pool account), NOT derived ATAs
    // PumpSwap uses non-standard vault addresses stored in pool account data
    const poolTokenATA = new PublicKey(quote.baseVault);
    const poolWsolATA = new PublicKey(quote.quoteVault);

    // Protocol fee is taken in WSOL (same as buy) - the fee recipient's WSOL ATA
    const feeATA = getAssociatedTokenAddressSync(WSOL_MINT, FEE_RECEIVER, true, TOKEN_PROGRAM_ID);

    // Coin creator's WSOL ATA for creator fee distribution (receives WSOL from the sale)
    const coinCreatorVaultATA = getAssociatedTokenAddressSync(WSOL_MINT, coinCreator, true, TOKEN_PROGRAM_ID);

    const instructions: TransactionInstruction[] = [];
    const cleanupInstructions: TransactionInstruction[] = [];

    // Check if user WSOL ATA exists (needed to receive SOL)
    const wsolAccInfo = await this.connection.getAccountInfo(userWsolATA);
    if (!wsolAccInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userWsolATA,
          wallet.publicKey,
          WSOL_MINT,
          TOKEN_PROGRAM_ID // Regular Token program for WSOL
        )
      );
    }

    // Build sell instruction data
    const data = Buffer.alloc(24);
    SELL_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(quote.tokenAmount, 8);
    data.writeBigUInt64LE(quote.minSolOut, 16);

    // Build sell instruction with 21 accounts (sells do NOT include volume accumulators)
    // IMPORTANT: For sells, base (token) comes BEFORE quote (WSOL) - same as buy!
    // Verified from successful on-chain sell transaction: 26frR8EyLBJ36ZXy77Xu...
    const sellInstruction = new TransactionInstruction({
      programId: PUMP_AMM_PROGRAM_ID,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },                      // [0] pool
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },           // [1] user
        { pubkey: GLOBAL_AUTHORITY, isSigner: false, isWritable: false },         // [2] global_config
        { pubkey: tokenMint, isSigner: false, isWritable: false },                // [3] base_mint (token first!)
        { pubkey: WSOL_MINT, isSigner: false, isWritable: false },                // [4] quote_mint (WSOL second)
        { pubkey: userTokenATA, isSigner: false, isWritable: true },              // [5] user_base_token_account
        { pubkey: userWsolATA, isSigner: false, isWritable: true },               // [6] user_quote_token_account
        { pubkey: poolTokenATA, isSigner: false, isWritable: true },              // [7] pool_base_token_account
        { pubkey: poolWsolATA, isSigner: false, isWritable: true },               // [8] pool_quote_token_account
        { pubkey: FEE_RECEIVER, isSigner: false, isWritable: false },             // [9] protocol_fee_recipient
        { pubkey: feeATA, isSigner: false, isWritable: true },                    // [10] protocol_fee_recipient_token_account (WSOL)
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },           // [11] base_token_program (Token or Token-2022)
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },         // [12] quote_token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },  // [13] system_program
        { pubkey: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), isSigner: false, isWritable: false }, // [14] associated_token_program
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },          // [15] event_authority
        { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },      // [16] program
        { pubkey: coinCreatorVaultATA, isSigner: false, isWritable: true },       // [17] coin_creator_vault_ata
        { pubkey: coinCreator, isSigner: false, isWritable: false },              // [18] coin_creator
        { pubkey: FEE_CONFIG, isSigner: false, isWritable: false },               // [19] fee_config (owned by PFEE)
        { pubkey: PFEE_PROGRAM, isSigner: false, isWritable: false },             // [20] fee_program
      ],
      data,
    });

    instructions.push(sellInstruction);

    // Cleanup: close WSOL account to get SOL back
    cleanupInstructions.push(
      createCloseAccountInstruction(
        userWsolATA,
        wallet.publicKey,
        wallet.publicKey
      )
    );

    return { instructions, cleanupInstructions };
  }

  /**
   * Check if a token is on PumpSwap (has a pump-amm pool)
   */
  async isOnPumpSwap(tokenMint: string): Promise<boolean> {
    const mint = new PublicKey(tokenMint);
    const pool = await this.findPool(mint);
    return pool !== null;
  }

  /**
   * Get token price from PumpSwap pool reserves
   * Returns price in SOL per token, or null if pool not found
   */
  async getTokenPrice(tokenMint: string): Promise<number | null> {
    try {
      const mint = new PublicKey(tokenMint);
      const pool = await this.findPool(mint);

      if (!pool) {
        return null;
      }

      const reserves = await this.getReserves(pool, mint);
      const { tokenReserve, solReserve } = reserves;

      if (tokenReserve === 0n) {
        return null;
      }

      // Price = SOL reserve / Token reserve
      // Normalize by decimal places (SOL has 9, tokens have 6)
      const price = (Number(solReserve) / 1e9) / (Number(tokenReserve) / 1e6);
      return price;
    } catch (error) {
      return null;
    }
  }
}

// Export constants for use in other services
export { PUMP_AMM_PROGRAM_ID, WSOL_MINT };

// Singleton instance for automation worker and other services
// Uses the same RPC as migration detector
const connection = new Connection(
  process.env.HELIUS_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || ''}`,
  { commitment: 'confirmed' }
);
export const pumpSwapService = new PumpSwapService(connection);
