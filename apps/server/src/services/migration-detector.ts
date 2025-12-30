import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { redis } from '../db/redis.js';
import { prisma } from '../db/client.js';

export interface MigrationEvent {
  tokenMint: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  poolAddress: string;
  bondingCurveAddress: string | null;
  initialLiquiditySol: number;
  initialPriceSol: number;
  timestamp: number;
}

interface DetectedMigration extends MigrationEvent {
  detectedBy: 'pumpportal' | 'helius' | 'raydium';
  detectedAt: number;
  latencyMs: number;
}

/**
 * MigrationDetector - Triple redundancy migration detection
 *
 * Primary: PumpPortal WebSocket (subscribeMigration)
 * Secondary: Helius Geyser/WebSocket (program monitoring)
 * Tertiary: Direct Raydium program monitoring
 *
 * All sources feed into a deduplication layer before broadcasting
 */
export class MigrationDetector extends EventEmitter {
  private pumpPortalWs: WebSocket | null = null;
  private heliusWs: WebSocket | null = null;
  private isRunning = false;
  private reconnectAttempts = { pumpPortal: 0, helius: 0 };
  private maxReconnectAttempts = 10;
  private recentMigrations = new Map<string, number>();
  private deduplicationWindowMs = 300000; // 5 minutes

  // Subscription confirmation tracking
  private subscriptionConfirmed = { pumpPortal: false, helius: false };

  // Configuration
  private pumpPortalUrl = 'wss://pumpportal.fun/api/data';
  private heliusApiKey = process.env.HELIUS_API_KEY || '';

  // Rate limiting for Helius API calls
  private lastHeliusFetch = 0;
  private readonly HELIUS_MIN_INTERVAL_MS = 500; // Max 2 transaction fetches/second
  private pendingHeliusFetches: string[] = [];
  private heliusFetchTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Migration detector already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting Migration Detector...');

    // Start PumpPortal only - it's the primary and lowest latency source
    // Helius WebSocket monitor disabled to save credits (was consuming ~500k+ credits/month)
    // PumpPortal is free and provides migration events directly
    await this.initPumpPortal();

    // Start cleanup interval for deduplication map
    setInterval(() => this.cleanupDeduplicationMap(), 60000);

    console.log('Migration Detector started (PumpPortal primary source)');
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.pumpPortalWs) {
      this.pumpPortalWs.close();
      this.pumpPortalWs = null;
    }

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

    console.log('Migration Detector stopped');
  }

  /**
   * Primary Source: PumpPortal WebSocket
   * Lowest latency for PumpFun migrations
   */
  private async initPumpPortal(): Promise<void> {
    return new Promise((resolve) => {
      try {
        console.log('Connecting to PumpPortal WebSocket...');

        this.pumpPortalWs = new WebSocket(this.pumpPortalUrl);

        this.pumpPortalWs.on('open', () => {
          console.log('PumpPortal WebSocket connected');
          this.reconnectAttempts.pumpPortal = 0;

          // Subscribe to migration events
          this.pumpPortalWs?.send(JSON.stringify({
            method: 'subscribeMigration',
          }));

          resolve();
        });

        this.pumpPortalWs.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            this.handlePumpPortalMessage(message);
          } catch (error) {
            console.error('Failed to parse PumpPortal message:', error);
          }
        });

        this.pumpPortalWs.on('close', (code, reason) => {
          console.log(`PumpPortal WebSocket closed: ${code} - ${reason}`);
          this.handlePumpPortalReconnect();
        });

        this.pumpPortalWs.on('error', (error) => {
          console.error('PumpPortal WebSocket error:', error);
        });

      } catch (error) {
        console.error('Failed to initialize PumpPortal:', error);
        resolve();
      }
    });
  }

  private handlePumpPortalMessage(message: any): void {
    // Handle subscription confirmation
    if (message.method === 'subscribeMigration' || message.subscribed === 'migration') {
      this.subscriptionConfirmed.pumpPortal = true;
      console.log('✓ PumpPortal migration subscription confirmed');
      return;
    }

    // Handle subscription acknowledgment (different format)
    if (message.message && message.message.includes('subscribed')) {
      this.subscriptionConfirmed.pumpPortal = true;
      console.log('✓ PumpPortal subscription acknowledged:', message.message);
      return;
    }

    // PumpPortal migration event structure
    if (message.txType === 'migration' || message.type === 'migration') {
      // Mark subscription as confirmed if we receive migration events
      if (!this.subscriptionConfirmed.pumpPortal) {
        this.subscriptionConfirmed.pumpPortal = true;
        console.log('✓ PumpPortal subscription confirmed (received migration event)');
      }

      const migration: MigrationEvent = {
        tokenMint: message.mint || message.tokenMint,
        tokenName: message.name || message.tokenName || null,
        tokenSymbol: message.symbol || message.tokenSymbol || null,
        poolAddress: message.pool || message.poolAddress || '',
        bondingCurveAddress: message.bondingCurve || message.bondingCurveAddress || null,
        initialLiquiditySol: parseFloat(message.initialLiquidity || message.solAmount || '0'),
        initialPriceSol: parseFloat(message.price || message.initialPrice || '0'),
        timestamp: message.timestamp || Date.now(),
      };

      this.processMigration(migration, 'pumpportal');
    }
  }

  private handlePumpPortalReconnect(): void {
    if (!this.isRunning) return;

    this.reconnectAttempts.pumpPortal++;

    if (this.reconnectAttempts.pumpPortal > this.maxReconnectAttempts) {
      console.error('PumpPortal max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts.pumpPortal), 30000);
    console.log(`Reconnecting to PumpPortal in ${delay}ms (attempt ${this.reconnectAttempts.pumpPortal})`);

    setTimeout(() => {
      if (this.isRunning) {
        this.initPumpPortal();
      }
    }, delay);
  }

  /**
   * Secondary Source: Helius WebSocket
   * Monitors Raydium program for new pool creation
   */
  private async initHeliusMonitor(): Promise<void> {
    if (!this.heliusApiKey) {
      console.warn('HELIUS_API_KEY not set, skipping Helius monitor');
      return;
    }

    return new Promise((resolve) => {
      try {
        const heliusWsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
        console.log('Connecting to Helius WebSocket...');

        this.heliusWs = new WebSocket(heliusWsUrl);

        this.heliusWs.on('open', () => {
          console.log('Helius WebSocket connected');
          this.reconnectAttempts.helius = 0;

          // Subscribe to Raydium CPMM program logs
          // Program ID for Raydium CPMM
          const raydiumCpmmProgram = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';

          this.heliusWs?.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'logsSubscribe',
            params: [
              { mentions: [raydiumCpmmProgram] },
              { commitment: 'confirmed' },
            ],
          }));

          resolve();
        });

        this.heliusWs.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleHeliusMessage(message);
          } catch (error) {
            console.error('Failed to parse Helius message:', error);
          }
        });

        this.heliusWs.on('close', () => {
          console.log('Helius WebSocket closed');
          this.handleHeliusReconnect();
        });

        this.heliusWs.on('error', (error) => {
          console.error('Helius WebSocket error:', error);
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
      this.subscriptionConfirmed.helius = true;
      console.log('✓ Helius subscription confirmed:', message.result);
      return;
    }

    // Handle log notifications
    if (message.method === 'logsNotification') {
      const logs = message.params?.result?.value?.logs || [];
      const signature = message.params?.result?.value?.signature;

      // Look for pool initialization logs (Raydium CPMM)
      const isPoolInit = logs.some((log: string) =>
        log.includes('Program log: Instruction: Initialize') ||
        log.includes('InitializePool') ||
        log.includes('Create pool')
      );

      if (isPoolInit && signature) {
        console.log(`Potential new pool detected via Helius: ${signature}`);

        // Queue the fetch with rate limiting instead of immediate fetch
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
   * Fetch and process a Raydium pool creation transaction from Helius
   */
  private async fetchAndProcessHeliusTransaction(signature: string): Promise<void> {
    if (!this.heliusApiKey) return;

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

      if (!tx) {
        console.log(`No transaction data found for ${signature}`);
        return;
      }

      // Look for Raydium CPMM pool creation in the transaction
      // The token transfers and account keys tell us about the pool
      const accountKeys = tx.accountData?.map((a: any) => a.account) || [];
      const tokenTransfers = tx.tokenTransfers || [];

      // Try to identify the token mint and pool from the transaction
      // Raydium CPMM pools have specific instruction patterns
      let tokenMint: string | null = null;
      let poolAddress: string | null = null;
      let liquiditySol = 0;

      // Look for non-SOL token transfers (the new token being added to pool)
      for (const transfer of tokenTransfers) {
        if (transfer.mint && transfer.mint !== 'So11111111111111111111111111111111111111112') {
          tokenMint = transfer.mint;
          break;
        }
      }

      // Look for SOL amount (native transfers represent liquidity)
      const nativeTransfers = tx.nativeTransfers || [];
      for (const transfer of nativeTransfers) {
        if (transfer.amount > liquiditySol) {
          liquiditySol = transfer.amount / 1e9; // Convert lamports to SOL
        }
      }

      // Pool address is typically in the account keys
      if (accountKeys.length > 2) {
        // The pool account is usually one of the first few accounts after the payer
        poolAddress = accountKeys[1] || accountKeys[2];
      }

      if (tokenMint && poolAddress) {
        console.log(`Helius detected pool: token=${tokenMint}, pool=${poolAddress}, liq=${liquiditySol} SOL`);

        const migration: MigrationEvent = {
          tokenMint,
          tokenName: null, // Would need additional lookup
          tokenSymbol: null,
          poolAddress,
          bondingCurveAddress: null,
          initialLiquiditySol: liquiditySol,
          initialPriceSol: 0, // Would need price calculation
          timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
        };

        this.processMigration(migration, 'helius');
      }
    } catch (error) {
      console.error('Error fetching Helius transaction:', error);
    }
  }

  private handleHeliusReconnect(): void {
    if (!this.isRunning) return;

    this.reconnectAttempts.helius++;

    if (this.reconnectAttempts.helius > this.maxReconnectAttempts) {
      console.error('Helius max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts.helius), 30000);
    console.log(`Reconnecting to Helius in ${delay}ms (attempt ${this.reconnectAttempts.helius})`);

    setTimeout(() => {
      if (this.isRunning) {
        this.initHeliusMonitor();
      }
    }, delay);
  }

  /**
   * Process and deduplicate migration events from all sources
   */
  private async processMigration(
    event: MigrationEvent,
    source: 'pumpportal' | 'helius' | 'raydium'
  ): Promise<void> {
    const key = event.tokenMint;
    const now = Date.now();

    // CRITICAL: Reject historical migrations
    // This prevents sniping old tokens that come through on reconnection or backfill
    const MAX_EVENT_AGE_MS = 60_000; // 60 seconds max - event timestamp to now
    const eventAge = now - event.timestamp;

    if (eventAge > MAX_EVENT_AGE_MS) {
      console.log(
        `Ignoring historical migration: ${event.tokenSymbol || event.tokenMint} ` +
        `(event age: ${Math.round(eventAge / 1000)}s)`
      );
      return;
    }

    // Check for duplicates
    if (this.recentMigrations.has(key)) {
      const firstDetection = this.recentMigrations.get(key)!;
      console.log(`Duplicate migration ignored: ${key} (first detected ${now - firstDetection}ms ago by another source)`);
      return;
    }

    // Mark as detected
    this.recentMigrations.set(key, now);

    const latencyMs = now - event.timestamp;
    const detectedMigration: DetectedMigration = {
      ...event,
      detectedBy: source,
      detectedAt: now,
      latencyMs,
    };

    console.log(`\n🚀 MIGRATION DETECTED`);
    console.log(`   Token: ${event.tokenSymbol || 'Unknown'} (${event.tokenMint})`);
    console.log(`   Pool: ${event.poolAddress}`);
    console.log(`   Liquidity: ${event.initialLiquiditySol} SOL`);
    console.log(`   Source: ${source}`);
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
          source,
          detectionLatencyMs: latencyMs,
        },
      });
    } catch (error) {
      console.error('Failed to store migration event:', error);
    }

    // Publish to Redis for distribution
    await redis.publish('migrations', JSON.stringify(detectedMigration));

    // Emit local event for snipe orchestrator
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
   * Get connection status for health checks
   */
  getStatus(): {
    isRunning: boolean;
    connections: {
      pumpPortal: boolean;
      helius: boolean;
    };
    subscriptions: {
      pumpPortal: boolean;
      helius: boolean;
    };
    recentMigrations: number;
  } {
    return {
      isRunning: this.isRunning,
      connections: {
        pumpPortal: this.pumpPortalWs?.readyState === WebSocket.OPEN,
        helius: this.heliusWs?.readyState === WebSocket.OPEN,
      },
      subscriptions: {
        pumpPortal: this.subscriptionConfirmed.pumpPortal,
        helius: this.subscriptionConfirmed.helius,
      },
      recentMigrations: this.recentMigrations.size,
    };
  }
}

// Singleton instance
export const migrationDetector = new MigrationDetector();
