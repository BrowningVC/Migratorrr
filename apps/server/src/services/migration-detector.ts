import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { redis } from '../db/redis.js';
import { prisma } from '../db/client.js';
import { tokenInfoService } from './token-info.js';

export interface MigrationEvent {
  tokenMint: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  poolAddress: string;
  bondingCurveAddress: string | null;
  coinCreator: string | null; // Original token creator - required for PumpSwap trades
  initialLiquiditySol: number;
  initialPriceSol: number;
  initialMarketCapUsd: number | null; // Market cap at migration - critical for accurate entry MCAP
  timestamp: number;
  isToken2022?: boolean; // True if this is a Token-2022 token (doesn't end with 'pump')
}

interface DetectedMigration extends MigrationEvent {
  detectedBy: 'helius';
  detectedAt: number;
  latencyMs: number;
}

/**
 * MigrationDetector - Helius-only migration detection
 *
 * Uses Helius WebSocket to monitor the Pump bonding curve program
 * for migration transactions. When "Instruction: Migrate" is detected,
 * fetches full transaction data to extract token mint and pool address.
 *
 * Benefits of Helius-only:
 * - Reliable pool addresses from actual transaction data
 * - Stale connection detection (continuous message flow)
 * - Single source of truth - no race conditions
 */
export class MigrationDetector extends EventEmitter {
  private heliusWs: WebSocket | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private recentMigrations = new Map<string, number>();
  private deduplicationWindowMs = 300000; // 5 minutes

  // Track processed signatures to prevent duplicate WebSocket notifications
  // Helius can sometimes send the same migration event multiple times
  private processedSignatures = new Set<string>();
  private readonly MAX_PROCESSED_SIGNATURES = 1000; // Limit memory usage

  // Track last message time to detect stalled connections
  private lastMessageTime = 0;
  private readonly STALE_CONNECTION_MS = 60000; // 1 minute - if no messages, reconnect
  private subscriptionConfirmed = false;

  // Helius configuration
  private heliusApiKey = process.env.HELIUS_API_KEY || '';

  // Rate limiting for Helius API calls
  private lastHeliusFetch = 0;
  private readonly HELIUS_MIN_INTERVAL_MS = 100; // 10 fetches/second max for speed
  private pendingHeliusFetches: string[] = [];
  private heliusFetchTimer: NodeJS.Timeout | null = null;

  // Health check interval reference for cleanup
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Migration detector already running');
      return;
    }

    if (!this.heliusApiKey) {
      console.error('HELIUS_API_KEY not set - migration detection will not work!');
      return;
    }

    this.isRunning = true;
    console.log('Starting Migration Detector (Helius-only)...');

    await this.initHeliusMonitor();

    // Start cleanup interval for deduplication map
    this.cleanupInterval = setInterval(() => this.cleanupDeduplicationMap(), 60000);

    // Periodic connection health check - reconnect if needed
    this.healthCheckInterval = setInterval(() => this.checkConnectionHealth(), 15000);

    // Helius recommends pings every minute to keep connection alive (10 min inactivity timeout)
    this.pingInterval = setInterval(() => this.sendPing(), 30000);

    console.log('Migration Detector started (Helius-only)');
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.heliusWs) {
      this.heliusWs.close();
      this.heliusWs = null;
    }

    // Clear pending Helius fetches
    if (this.heliusFetchTimer) {
      clearTimeout(this.heliusFetchTimer);
      this.heliusFetchTimer = null;
    }
    this.pendingHeliusFetches = [];

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    console.log('Migration Detector stopped');
  }

  /**
   * Send a ping to keep the WebSocket connection alive
   * Helius has a 10-minute inactivity timeout
   */
  private sendPing(): void {
    if (this.heliusWs?.readyState === WebSocket.OPEN) {
      try {
        // Standard WebSocket ping
        this.heliusWs.ping();
      } catch (error) {
        console.warn('[Ping] Failed to send ping:', error);
      }
    }
  }

  /**
   * Initialize Helius WebSocket connection
   * Monitors Pump bonding curve program for migration transactions
   */
  private async initHeliusMonitor(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const heliusWsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
        console.log('Connecting to Helius WebSocket...');

        this.heliusWs = new WebSocket(heliusWsUrl);

        this.heliusWs.on('open', () => {
          console.log('Helius WebSocket connected');
          this.reconnectAttempts = 0;
          this.lastMessageTime = Date.now();

          // Subscribe to Pump bonding curve program for migrations
          // When a token migrates, the Pump program logs "Instruction: Migrate"
          // Pump bonding curve program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
          const pumpBondingCurveProgram = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

          this.heliusWs?.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'logsSubscribe',
            params: [
              { mentions: [pumpBondingCurveProgram] },
              { commitment: 'confirmed' },
            ],
          }));

          resolve();
        });

        this.heliusWs.on('message', (data: Buffer) => {
          // Track last message time for stale connection detection
          this.lastMessageTime = Date.now();
          try {
            const message = JSON.parse(data.toString());
            this.handleHeliusMessage(message);
          } catch (error) {
            console.error('Failed to parse Helius message:', error);
          }
        });

        this.heliusWs.on('close', () => {
          console.log('Helius WebSocket closed');
          this.subscriptionConfirmed = false;
          this.handleHeliusReconnect();
        });

        this.heliusWs.on('error', (error) => {
          console.error('Helius WebSocket error:', error);
          resolve();
        });

      } catch (error) {
        console.error('Failed to initialize Helius monitor:', error);
        resolve();
      }
    });
  }

  private handleHeliusMessage(message: any): void {
    // Handle subscription confirmation
    if (message.result !== undefined) {
      this.subscriptionConfirmed = true;
      console.log('✓ Helius subscription confirmed:', message.result);
      return;
    }

    // Handle log notifications
    if (message.method === 'logsNotification') {
      const logs = message.params?.result?.value?.logs || [];
      const signature = message.params?.result?.value?.signature;

      // Look for the actual migrate instruction - this is the ONLY reliable signal
      // The Pump program logs "Instruction: Migrate" when graduating to PumpSwap
      const hasMigrateInstruction = logs.some((log: string) =>
        log === 'Program log: Instruction: Migrate'
      );

      if (hasMigrateInstruction && signature) {
        // CRITICAL: Deduplicate by signature FIRST to prevent processing same tx twice
        // Helius WebSocket can sometimes send duplicate notifications for the same transaction
        if (this.processedSignatures.has(signature)) {
          console.log(`   ⏭️  Ignoring duplicate signature: ${signature.slice(0, 20)}...`);
          return;
        }

        // Mark signature as processed
        this.processedSignatures.add(signature);

        // Limit memory usage by clearing old signatures when set gets too large
        if (this.processedSignatures.size > this.MAX_PROCESSED_SIGNATURES) {
          const iterator = this.processedSignatures.values();
          // Remove oldest 20% of signatures
          const toRemove = Math.floor(this.MAX_PROCESSED_SIGNATURES * 0.2);
          for (let i = 0; i < toRemove; i++) {
            const oldest = iterator.next().value;
            if (oldest) this.processedSignatures.delete(oldest);
          }
        }

        console.log(`\n🔔 MIGRATION detected via Helius: ${signature}`);

        // Queue the fetch immediately - process as fast as possible
        this.queueHeliusFetch(signature);
      }
    }
  }

  /**
   * Queue a Helius transaction fetch with rate limiting
   */
  private queueHeliusFetch(signature: string): void {
    // Avoid duplicate fetches
    if (this.pendingHeliusFetches.includes(signature)) return;

    this.pendingHeliusFetches.push(signature);

    // Process queue if not already running
    if (!this.heliusFetchTimer) {
      this.processHeliusFetchQueue();
    }
  }

  /**
   * Process the Helius fetch queue with rate limiting
   */
  private processHeliusFetchQueue(): void {
    if (this.pendingHeliusFetches.length === 0) {
      this.heliusFetchTimer = null;
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastHeliusFetch;
    const delay = Math.max(0, this.HELIUS_MIN_INTERVAL_MS - elapsed);

    this.heliusFetchTimer = setTimeout(async () => {
      const signature = this.pendingHeliusFetches.shift();
      if (signature) {
        this.lastHeliusFetch = Date.now();
        try {
          await this.fetchAndProcessHeliusTransaction(signature);
        } catch (error) {
          console.error('Error processing Helius transaction:', error);
        }
      }
      // Continue processing queue
      this.processHeliusFetchQueue();
    }, delay);
  }

  /**
   * Fetch and process a migration transaction from Helius
   */
  private async fetchAndProcessHeliusTransaction(signature: string): Promise<void> {
    const fetchStart = Date.now();
    console.log(`   📡 Fetching transaction: ${signature.slice(0, 20)}...`);

    try {
      // Use Helius enhanced transaction API for parsed data
      const response = await fetch(
        `https://api.helius.xyz/v0/transactions/?api-key=${this.heliusApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions: [signature] }),
        }
      );

      if (!response.ok) {
        console.error('Helius transaction fetch failed:', await response.text());
        return;
      }

      const transactions = await response.json();
      const tx = transactions[0];
      const fetchDuration = Date.now() - fetchStart;

      if (!tx) {
        console.log(`   ❌ No transaction data found for ${signature}`);
        return;
      }

      // Extract token mint, pool address, coinCreator, and liquidity from the transaction
      const { tokenMint, poolAddress, coinCreator, liquiditySol, isToken2022 } = this.parseTransactionData(tx);

      console.log(`   📊 Parsed in ${fetchDuration}ms: token=${tokenMint?.slice(0, 12) || 'null'}, pool=${poolAddress?.slice(0, 12) || 'null'}, creator=${coinCreator?.slice(0, 12) || 'null'}, liq=${liquiditySol.toFixed(2)} SOL${isToken2022 ? ' [Token-2022]' : ''}`);

      if (tokenMint && poolAddress) {
        // Only process PumpFun tokens:
        // - SPL tokens end with 'pump'
        // - Token-2022 tokens don't have this suffix but are detected by the Token-2022 program
        const isPumpSuffix = tokenMint.endsWith('pump');
        if (!isPumpSuffix && !isToken2022) {
          console.log(`   ⏭️  Skipping non-PumpFun token: ${tokenMint.slice(0, 12)}...`);
          return;
        }

        // PumpFun tokens graduate to Raydium at approximately $68,000 market cap
        // Calculate based on ~85 SOL liquidity * $200/SOL * 4 (typical FDV multiplier at graduation)
        // Or use the standard graduation market cap of ~$68,000
        const SOL_PRICE_USD = 200; // Approximate - could fetch live price for accuracy
        const PUMPFUN_GRADUATION_MCAP_USD = 68000; // Standard graduation threshold

        // Calculate market cap: if we have liquidity, estimate from it, otherwise use standard
        const estimatedMarketCapUsd = liquiditySol > 0
          ? Math.round(liquiditySol * SOL_PRICE_USD * 4) // Rough estimate: liquidity * SOL price * multiplier
          : PUMPFUN_GRADUATION_MCAP_USD;

        console.log(`\n🚀 PUMPFUN MIGRATION CONFIRMED!${isToken2022 ? ' [Token-2022]' : ''}`);
        console.log(`   Token: ${tokenMint}`);
        console.log(`   Pool: ${poolAddress}`);
        console.log(`   Creator: ${coinCreator || 'NOT FOUND'}`);
        console.log(`   Liquidity: ${liquiditySol.toFixed(2)} SOL`);
        console.log(`   Est. Market Cap: $${estimatedMarketCapUsd.toLocaleString()}`);

        if (!coinCreator) {
          console.log(`   ⚠️ WARNING: coinCreator not found - trades may fail!`);
        }

        const migration: MigrationEvent = {
          tokenMint,
          tokenName: null,
          tokenSymbol: null,
          poolAddress,
          bondingCurveAddress: null,
          coinCreator, // CRITICAL: Pass coinCreator for PumpSwap trades
          initialLiquiditySol: liquiditySol,
          initialPriceSol: 0,
          initialMarketCapUsd: estimatedMarketCapUsd, // CRITICAL: Capture market cap at migration for accurate entry MCAP
          timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
          isToken2022, // Flag for Token-2022 tokens (don't end with 'pump')
        };

        this.processMigration(migration, isToken2022);
      } else {
        console.log(`   ⚠️ Could not extract token/pool from transaction`);
      }
    } catch (error) {
      console.error('Error fetching Helius transaction:', error);
    }
  }

  /**
   * Parse Helius transaction data to extract migration details
   *
   * The Pump bonding curve migrate instruction has this account layout:
   * - Index 2: Token mint (ends with 'pump' for SPL tokens, or any mint for Token-2022)
   * - Index 9: Pool address (PumpSwap pool)
   * - Index 19: Token program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA for SPL, TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb for Token-2022)
   *
   * The PumpSwap AMM createPool instruction (23 accounts) has:
   * - Index 18: coin_creator_vault_authority (the original token creator)
   */
  private parseTransactionData(tx: any): {
    tokenMint: string | null;
    poolAddress: string | null;
    coinCreator: string | null;
    liquiditySol: number;
    isToken2022: boolean;
  } {
    const tokenTransfers = tx.tokenTransfers || [];
    const instructions = tx.instructions || [];
    const innerInstructions = tx.innerInstructions || [];
    const nativeTransfers = tx.nativeTransfers || [];

    let tokenMint: string | null = null;
    let poolAddress: string | null = null;
    let coinCreator: string | null = null;
    let liquiditySol = 0;
    let isToken2022 = false;

    // Find the Pump bonding curve migrate instruction
    // Program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
    const PUMP_BONDING_CURVE_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    // PumpSwap AMM program: pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
    const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    // Token-2022 program
    const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

    // Collect all instructions including inner (CPI) instructions
    // The PumpSwap createPool is called via CPI from the migrate instruction
    const allInstructions = [...instructions];
    for (const innerGroup of innerInstructions) {
      if (innerGroup.instructions) {
        allInstructions.push(...innerGroup.instructions);
      }
    }

    for (const ix of allInstructions) {
      if (ix.programId === PUMP_BONDING_CURVE_PROGRAM) {
        const accounts = ix.accounts || [];

        // Check if this is a Token-2022 migration (Token-2022 program at index 19)
        if (accounts[19] === TOKEN_2022_PROGRAM) {
          isToken2022 = true;
          console.log(`   🔷 Token-2022 migration detected`);
        }

        // Token mint is at index 2
        // For SPL tokens: ends with 'pump'
        // For Token-2022 tokens: any valid pubkey (doesn't end with 'pump')
        if (accounts[2] && typeof accounts[2] === 'string') {
          const isPumpSuffix = accounts[2].endsWith('pump');
          if (isPumpSuffix || isToken2022) {
            tokenMint = accounts[2];
            if (!isPumpSuffix) {
              console.log(`   🔷 Token-2022 mint: ${tokenMint}`);
            }
          }
        }

        // Pool address is at index 9
        if (accounts[9] && typeof accounts[9] === 'string') {
          poolAddress = accounts[9];
        }
      }

      // Extract coinCreator from PumpSwap AMM createPool instruction (23 accounts)
      // This is CRITICAL for building valid buy/sell transactions
      if (ix.programId === PUMP_AMM_PROGRAM) {
        const accounts = ix.accounts || [];
        console.log(`   🔍 PumpSwap AMM instruction found, ${accounts.length} accounts`);
        // coin_creator_vault_authority is at index 18 in the 23-account createPool instruction
        if (accounts.length >= 19 && accounts[18] && typeof accounts[18] === 'string') {
          coinCreator = accounts[18];
          console.log(`   💎 Found coinCreator from AMM instruction: ${coinCreator.slice(0, 12)}...`);
        } else {
          console.log(`   ⚠️ AMM instruction has ${accounts.length} accounts, expected 19+`);
          if (accounts[18]) {
            console.log(`   ⚠️ accounts[18] type: ${typeof accounts[18]}, value: ${JSON.stringify(accounts[18]).slice(0, 50)}`);
          }
        }
      }
    }

    // Debug: Log if we didn't find coinCreator
    if (!coinCreator) {
      console.log(`   ⚠️ coinCreator not found. Top-level instructions: ${instructions.length}, Inner instruction groups: ${innerInstructions.length}`);
      for (const ix of instructions) {
        console.log(`      - programId: ${ix.programId}, accounts: ${(ix.accounts || []).length}`);
      }
      // Also log inner instructions
      for (let i = 0; i < innerInstructions.length; i++) {
        const group = innerInstructions[i];
        const innerIxs = group.instructions || [];
        console.log(`      Inner group ${i}: ${innerIxs.length} instructions`);
        for (const ix of innerIxs) {
          console.log(`         - programId: ${ix.programId}, accounts: ${(ix.accounts || []).length}`);
        }
      }
    }

    // Fallback: Look for PumpFun token in token transfers
    // For SPL tokens, look for 'pump' suffix; for Token-2022, we already have the mint
    if (!tokenMint) {
      for (const transfer of tokenTransfers) {
        if (transfer.mint && transfer.mint.endsWith('pump')) {
          tokenMint = transfer.mint;
          break;
        }
      }
    }

    // Extract SOL liquidity amount
    for (const transfer of nativeTransfers) {
      if (transfer.amount > liquiditySol) {
        liquiditySol = transfer.amount / 1e9; // Convert lamports to SOL
      }
    }

    return { tokenMint, poolAddress, coinCreator, liquiditySol, isToken2022 };
  }

  private handleHeliusReconnect(): void {
    if (!this.isRunning) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error('Helius max reconnect attempts reached - stopping detection');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`Reconnecting to Helius in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      if (this.isRunning) {
        await this.initHeliusMonitor();
        // After successful reconnect, catch up on any missed migrations
        await this.catchUpMissedMigrations();
      }
    }, delay);
  }

  /**
   * Catch up on migrations that may have been missed during disconnect
   * Fetches recent migrations from the database and checks for any
   * that happened in the last 60 seconds that we haven't processed
   */
  private async catchUpMissedMigrations(): Promise<void> {
    const CATCH_UP_WINDOW_MS = 60_000; // 60 seconds
    const cutoffTime = new Date(Date.now() - CATCH_UP_WINDOW_MS);

    try {
      console.log('[Catch-up] Checking for missed migrations during disconnect...');

      // Fetch recent migrations from database that we might have missed
      // Note: MigrationEvent uses 'detectedAt' not 'createdAt'
      const recentMigrations = await prisma.migrationEvent.findMany({
        where: {
          detectedAt: { gte: cutoffTime },
        },
        orderBy: { detectedAt: 'desc' },
        take: 20, // Limit to most recent 20
      });

      if (recentMigrations.length === 0) {
        console.log('[Catch-up] No recent migrations found');
        return;
      }

      let caughtUp = 0;
      for (const migration of recentMigrations) {
        // Skip if we already processed this one
        if (this.recentMigrations.has(migration.tokenMint)) {
          continue;
        }

        // Skip if too old (processMigration will reject it anyway)
        const age = Date.now() - migration.detectedAt.getTime();
        if (age > CATCH_UP_WINDOW_MS) {
          continue;
        }

        // Skip if no pool address (required for trading)
        if (!migration.poolAddress) {
          console.log(`[Catch-up] Skipping migration without pool address: ${migration.tokenMint.slice(0, 12)}`);
          continue;
        }

        console.log(`[Catch-up] Re-emitting missed migration: ${migration.tokenSymbol || migration.tokenMint.slice(0, 12)}`);

        // Re-emit the migration event
        const event: MigrationEvent = {
          tokenMint: migration.tokenMint,
          tokenName: migration.tokenName || null,
          tokenSymbol: migration.tokenSymbol || null,
          poolAddress: migration.poolAddress,
          bondingCurveAddress: migration.bondingCurveAddress || null,
          coinCreator: null, // Will be fetched by snipe orchestrator if needed
          initialLiquiditySol: migration.initialLiquiditySol ?? 0,
          initialPriceSol: migration.initialPriceSol ?? 0,
          initialMarketCapUsd: migration.initialMarketCapUsd ?? null,
          timestamp: migration.detectedAt.getTime(),
        };

        await this.processMigration(event, !migration.tokenMint.endsWith('pump'));
        caughtUp++;
      }

      if (caughtUp > 0) {
        console.log(`[Catch-up] Re-emitted ${caughtUp} missed migration(s)`);
      } else {
        console.log('[Catch-up] No missed migrations to catch up on');
      }
    } catch (error) {
      console.error('[Catch-up] Failed to catch up on missed migrations:', error);
      // Non-fatal - continue running
    }
  }

  /**
   * Process and deduplicate migration events
   */
  private async processMigration(event: MigrationEvent, isToken2022: boolean = false): Promise<void> {
    const key = event.tokenMint;
    const now = Date.now();

    // Safety check: only process PumpFun tokens
    // SPL tokens end with 'pump', Token-2022 tokens don't but are explicitly flagged
    const isPumpSuffix = event.tokenMint?.endsWith('pump');
    if (!event.tokenMint || (!isPumpSuffix && !isToken2022)) {
      console.log(`Rejecting non-PumpFun token: ${event.tokenMint?.slice(0, 16) || 'null'}`);
      return;
    }

    // Reject historical migrations (older than 60 seconds)
    const MAX_EVENT_AGE_MS = 60_000;
    const eventAge = now - event.timestamp;

    if (eventAge > MAX_EVENT_AGE_MS) {
      console.log(`Ignoring historical migration: ${event.tokenMint} (age: ${Math.round(eventAge / 1000)}s)`);
      return;
    }

    // Check for duplicates
    if (this.recentMigrations.has(key)) {
      const firstDetection = this.recentMigrations.get(key)!;
      console.log(`Duplicate migration ignored: ${key} (first detected ${now - firstDetection}ms ago)`);
      return;
    }

    // Mark as detected
    this.recentMigrations.set(key, now);

    // Emit migration event
    await this.emitMigration(event, now);
  }

  /**
   * Emit a migration event to listeners
   */
  private async emitMigration(event: MigrationEvent, detectedAt: number): Promise<void> {
    const latencyMs = detectedAt - event.timestamp;

    // Fetch token metadata in background (non-blocking)
    this.fetchAndBroadcastTokenMetadata(event.tokenMint);

    const detectedMigration: DetectedMigration = {
      ...event,
      detectedBy: 'helius',
      detectedAt,
      latencyMs,
    };

    console.log(`\n🎯 EMITTING MIGRATION TO SNIPE ORCHESTRATOR`);
    console.log(`   Token: ${event.tokenMint}`);
    console.log(`   Pool: ${event.poolAddress}`);
    console.log(`   CoinCreator: ${event.coinCreator || 'NULL'}`);
    console.log(`   Latency: ${latencyMs}ms\n`);

    // Store in database for analytics
    try {
      await prisma.migrationEvent.create({
        data: {
          tokenMint: event.tokenMint,
          tokenName: event.tokenName,
          tokenSymbol: event.tokenSymbol,
          bondingCurveAddress: event.bondingCurveAddress,
          poolAddress: event.poolAddress,
          initialLiquiditySol: event.initialLiquiditySol,
          initialPriceSol: event.initialPriceSol,
          initialMarketCapUsd: event.initialMarketCapUsd, // Store market cap at migration
          source: 'helius',
          detectionLatencyMs: latencyMs,
        },
      });
    } catch (error) {
      console.error('Failed to store migration event:', error);
    }

    // Publish to Redis for distribution
    await redis.publish('migrations', JSON.stringify(detectedMigration));

    // Emit local event for snipe orchestrator - THIS IS THE KEY EVENT
    this.emit('migration', detectedMigration);
  }

  /**
   * Cleanup old entries from deduplication map
   */
  private cleanupDeduplicationMap(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, timestamp] of this.recentMigrations.entries()) {
      if (now - timestamp > this.deduplicationWindowMs) {
        this.recentMigrations.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`Cleaned ${cleaned} entries from migration deduplication map`);
    }
  }

  /**
   * Periodic health check - reconnect if stalled
   */
  private checkConnectionHealth(): void {
    const now = Date.now();
    const connected = this.heliusWs?.readyState === WebSocket.OPEN;
    const age = this.lastMessageTime > 0 ? Math.round((now - this.lastMessageTime) / 1000) : 0;
    const stale = connected && this.lastMessageTime > 0 && (now - this.lastMessageTime) > this.STALE_CONNECTION_MS;

    console.log(`[Health Check] Helius: ${connected ? '✓' : '✗'} (sub: ${this.subscriptionConfirmed}, age: ${age}s)${stale ? ' ⚠️ STALE - reconnecting' : ''}`);

    // Reconnect if disconnected or stalled
    if ((!connected || stale) && this.isRunning) {
      console.log(`[Health Check] Helius ${stale ? 'stalled' : 'disconnected'} - forcing reconnect...`);
      this.heliusWs?.close();
      this.heliusWs = null;
      this.subscriptionConfirmed = false;
      this.lastMessageTime = 0;
      this.reconnectAttempts = 0;
      this.initHeliusMonitor();
    }
  }

  /**
   * Fetch token metadata in background
   */
  private async fetchAndBroadcastTokenMetadata(tokenMint: string): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [500, 2000, 5000];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
      }

      try {
        const metadata = await tokenInfoService.getTokenMetadata(tokenMint);

        if (metadata?.symbol) {
          console.log(`   ✓ Token metadata: ${metadata.symbol} (attempt ${attempt + 1})`);

          prisma.migrationEvent.updateMany({
            where: { tokenMint },
            data: {
              tokenSymbol: metadata.symbol,
              tokenName: metadata.name || undefined,
            },
          }).catch((err) => console.error('Failed to update token metadata:', err));

          redis.publish('migration-update', JSON.stringify({
            tokenMint,
            tokenSymbol: metadata.symbol,
            tokenName: metadata.name,
          })).catch(() => {});

          return;
        }
      } catch {
        // Continue to next retry
      }
    }
  }

  /**
   * Get connection status for health checks
   */
  getStatus(): {
    isRunning: boolean;
    connected: boolean;
    subscribed: boolean;
    lastMessageAge: number;
    recentMigrations: number;
  } {
    return {
      isRunning: this.isRunning,
      connected: this.heliusWs?.readyState === WebSocket.OPEN,
      subscribed: this.subscriptionConfirmed,
      lastMessageAge: this.lastMessageTime > 0 ? Date.now() - this.lastMessageTime : 0,
      recentMigrations: this.recentMigrations.size,
    };
  }
}

// Singleton instance
export const migrationDetector = new MigrationDetector();
