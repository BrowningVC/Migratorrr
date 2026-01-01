import { prisma } from '../db/client.js';
import { transactionExecutor } from '../services/transaction-executor.js';
import { emitToUser } from '../websocket/handlers.js';
import { redis } from '../db/redis.js';
import { pumpSwapService } from '../services/pumpswap.js';

interface PriceData {
  mint: string;
  price: number;
  timestamp: number;
}

/**
 * AutomationWorker - Monitors positions and executes automated sells
 *
 * Responsibilities:
 * 1. Monitor token prices every 500ms
 * 2. Execute take profit orders when price target hit
 * 3. Execute stop loss orders when price drops below threshold
 * 4. Handle trailing stops (update highest price, trigger on pullback)
 */
export class AutomationWorker {
  private isRunning = false;
  private priceMonitorInterval: NodeJS.Timeout | null = null;
  private priceCache = new Map<string, PriceData>();
  private monitorIntervalMs = 500; // Check prices every 500ms
  // Track positions with recent sell attempts to prevent repeated triggers
  private sellAttemptCooldown = new Map<string, number>();
  private readonly SELL_COOLDOWN_MS = 30000; // 30 second cooldown between sell attempts

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Automation worker already running');
      return;
    }

    this.isRunning = true;

    // Start the price monitoring loop
    this.priceMonitorInterval = setInterval(
      () => this.monitorPrices().catch(console.error),
      this.monitorIntervalMs
    );

    console.log('Automation Worker started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.priceMonitorInterval) {
      clearInterval(this.priceMonitorInterval);
      this.priceMonitorInterval = null;
    }

    console.log('Automation Worker stopped');
  }

  /**
   * Main price monitoring loop
   */
  private async monitorPrices(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get all open positions with automation settings
      const positions = await prisma.position.findMany({
        where: {
          status: 'open',
          OR: [
            { takeProfitPrice: { not: null } },
            { stopLossPrice: { not: null } },
            { trailingStopPct: { not: null } },
          ],
        },
        include: {
          user: {
            select: {
              id: true,
            },
          },
          sniper: {
            select: {
              id: true,
              walletId: true,
              config: true,
            },
          },
        },
      });

      if (positions.length === 0) {
        return;
      }

      // Get unique token mints
      const mints = [...new Set(positions.map((p: { tokenMint: string }) => p.tokenMint))] as string[];

      // Batch fetch prices
      const prices = await this.fetchPrices(mints);

      // Process each position
      for (const position of positions) {
        const price = prices.get(position.tokenMint);
        if (!price) continue;

        await this.processPosition(position, price);
      }
    } catch (error) {
      console.error('Price monitoring error:', error);
    }
  }

  /**
   * Fetch prices for multiple tokens from PumpSwap pools
   * PumpSwap tokens (migrated from pump.fun) don't have prices on Raydium/Jupiter
   * We calculate prices directly from pool reserves
   */
  private async fetchPrices(mints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const now = Date.now();

    // Check cache first (prices older than 500ms are stale for automation)
    const cacheMisses: string[] = [];
    for (const mint of mints) {
      const cached = this.priceCache.get(mint);
      if (cached && now - cached.timestamp < 500) {
        prices.set(mint, cached.price);
      } else {
        cacheMisses.push(mint);
      }
    }

    if (cacheMisses.length === 0) {
      return prices;
    }

    // Fetch prices from PumpSwap pools
    // Each token needs its own pool lookup
    const pricePromises = cacheMisses.map(async (mint) => {
      try {
        const price = await pumpSwapService.getTokenPrice(mint);
        if (price !== null) {
          prices.set(mint, price);
          this.priceCache.set(mint, { mint, price, timestamp: now });
        }
      } catch (error) {
        // Silently ignore individual price fetch failures
      }
    });

    // Fetch all prices in parallel
    await Promise.allSettled(pricePromises);

    return prices;
  }

  /**
   * Process a single position for automation triggers
   */
  private async processPosition(
    position: {
      id: string;
      userId: string;
      tokenMint: string;
      tokenSymbol: string | null;
      entryPrice: number | null;
      currentTokenAmount: number | null;
      takeProfitPrice: number | null;
      stopLossPrice: number | null;
      trailingStopPct: number | null;
      highestPrice: number | null;
      sniper: {
        id: string;
        walletId: string;
        config: unknown;
      } | null;
    },
    currentPrice: number
  ): Promise<void> {
    const {
      id,
      userId,
      tokenMint,
      tokenSymbol,
      entryPrice,
      takeProfitPrice,
      stopLossPrice,
      trailingStopPct,
      highestPrice,
    } = position;

    if (!entryPrice) return;

    // Calculate P&L
    const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;

    // Emit price update to user (throttled)
    await this.emitPriceUpdate(userId, {
      positionId: id,
      tokenMint,
      tokenSymbol,
      currentPrice,
      entryPrice,
      pnlPct,
    });

    // Check take profit
    if (takeProfitPrice && currentPrice >= takeProfitPrice) {
      console.log(`Take profit triggered for position ${id}`);
      await this.executeSell(position, currentPrice, 'take_profit');
      return;
    }

    // Check stop loss
    if (stopLossPrice && currentPrice <= stopLossPrice) {
      console.log(`Stop loss triggered for position ${id}`);
      await this.executeSell(position, currentPrice, 'stop_loss');
      return;
    }

    // Check trailing stop
    if (trailingStopPct) {
      // Initialize highestPrice if null (can happen if trailing stop was enabled after position creation)
      const effectiveHighestPrice = highestPrice ?? entryPrice;

      // Update highest price if current is higher
      if (currentPrice > effectiveHighestPrice) {
        await prisma.position.update({
          where: { id },
          data: { highestPrice: currentPrice },
        });
      } else if (!highestPrice) {
        // First time seeing this position with trailing stop - initialize highestPrice
        await prisma.position.update({
          where: { id },
          data: { highestPrice: effectiveHighestPrice },
        });
      }

      // CRITICAL FIX: Only activate trailing stop AFTER position has been in profit
      // This prevents immediate triggers on positions that never went up
      // A position is considered "in profit" when highestPrice > entryPrice
      const hasBeenInProfit = effectiveHighestPrice > entryPrice;

      if (!hasBeenInProfit) {
        // Position has never been in profit - trailing stop not yet active
        // The regular stop loss (if configured) will protect against downside
        return;
      }

      // Check if price dropped by trailing stop percentage from highest
      const peakPrice = Math.max(effectiveHighestPrice, currentPrice);
      const dropPct = ((peakPrice - currentPrice) / peakPrice) * 100;
      if (dropPct >= trailingStopPct) {
        console.log(`Trailing stop triggered for position ${id} (peak: ${peakPrice.toExponential(2)}, current: ${currentPrice.toExponential(2)}, drop: ${dropPct.toFixed(1)}%)`);
        await this.executeSell(position, currentPrice, 'trailing_stop');
        return;
      }
    }
  }

  /**
   * Execute a sell for automation trigger
   */
  private async executeSell(
    position: {
      id: string;
      userId: string;
      tokenMint: string;
      tokenSymbol: string | null;
      currentTokenAmount: number | null;
      sniper: {
        id: string;
        walletId: string;
        config: unknown;
      } | null;
    },
    currentPrice: number,
    reason: 'take_profit' | 'stop_loss' | 'trailing_stop'
  ): Promise<void> {
    const { id, userId, tokenMint, tokenSymbol, currentTokenAmount, sniper } =
      position;

    // Check cooldown to prevent repeated sell attempts for same position
    const lastAttempt = this.sellAttemptCooldown.get(id);
    if (lastAttempt && Date.now() - lastAttempt < this.SELL_COOLDOWN_MS) {
      // Position is in cooldown from a recent failed attempt
      return;
    }

    if (!sniper || !currentTokenAmount) {
      console.error(`Cannot execute sell for position ${id}: missing data`);
      return;
    }

    // CRITICAL: Verify wallet exists and belongs to user before executing
    const wallet = await prisma.wallet.findUnique({
      where: { id: sniper.walletId },
      select: { id: true, userId: true, walletType: true },
    });

    if (!wallet) {
      console.error(`Automation sell blocked: wallet ${sniper.walletId} not found for position ${id}`);
      return;
    }

    if (wallet.userId !== userId) {
      console.error(`Automation sell blocked: wallet ${sniper.walletId} ownership mismatch for position ${id}`);
      return;
    }

    if (wallet.walletType !== 'generated') {
      console.error(`Automation sell blocked: wallet ${sniper.walletId} is not a generated wallet for position ${id}`);
      return;
    }

    // Atomically mark position as selling to prevent duplicate triggers (race condition safe)
    const updateResult = await prisma.position.updateMany({
      where: { id, status: 'open' },
      data: { status: 'selling' },
    });

    if (updateResult.count === 0) {
      // Position was already being processed or closed
      console.log(`Position ${id} already being processed, skipping ${reason} trigger`);
      return;
    }

    // Mark this position as having a sell attempt in progress
    this.sellAttemptCooldown.set(id, Date.now());

    // Extract config
    const config = sniper.config as { slippageBps?: number; priorityFeeSol?: number };

    // Execute the sell
    try {
      const result = await transactionExecutor.executeSell({
        userId,
        walletId: sniper.walletId,
        positionId: id,
        tokenMint,
        tokenAmount: currentTokenAmount,
        slippageBps: config.slippageBps || 2000, // 20% default slippage for autosells (volatile meme tokens)
        priorityFeeSol: config.priorityFeeSol || 0.001,
        reason,
      });

      if (result.success) {
        // Clear cooldown on success
        this.sellAttemptCooldown.delete(id);

        await prisma.position.update({
          where: { id },
          data: {
            status: 'closed',
            closedAt: new Date(),
            exitPrice: currentPrice,
            exitSol: result.solReceived || 0, // executeSell returns solReceived, not solSpent
          },
        });

        // Emit events to frontend for real-time updates
        // NOTE: Activity log is already created by transactionExecutor.executeSell() -> recordSellTransaction()
        const reasonLabels = {
          take_profit: 'Take profit triggered',
          stop_loss: 'Stop loss triggered',
          trailing_stop: 'Trailing stop triggered',
        };

        await emitToUser(userId, `position:${reason}`, {
          positionId: id,
          tokenMint,
          tokenSymbol,
          currentPrice,
          reason: reasonLabels[reason],
          signature: result.signature,
        });

        await emitToUser(userId, 'position:closed', {
          positionId: id,
          tokenMint,
          tokenSymbol,
          reason,
          signature: result.signature,
          exitPrice: currentPrice,
        });

        console.log(`Position ${id} closed successfully via ${reason}`);
      } else {
        // Revert to open status on failure, but keep cooldown active to prevent immediate retry
        await prisma.position.update({
          where: { id },
          data: { status: 'open' },
        });

        // Notify user of failure (but don't log to activity - only successful sells get logged)
        await emitToUser(userId, 'position:sell_failed', {
          positionId: id,
          tokenMint,
          tokenSymbol,
          reason,
          error: result.error,
        });

        console.error(`Failed to close position ${id}: ${result.error} (cooldown for ${this.SELL_COOLDOWN_MS / 1000}s)`);
      }
    } catch (error) {
      // Revert to open status on error, but keep cooldown active to prevent immediate retry
      await prisma.position.update({
        where: { id },
        data: { status: 'open' },
      });

      console.error(`Error executing sell for position ${id}:`, error, `(cooldown for ${this.SELL_COOLDOWN_MS / 1000}s)`);
    }
  }

  /**
   * Emit price update to user (throttled to avoid flooding)
   */
  private async emitPriceUpdate(
    userId: string,
    data: {
      positionId: string;
      tokenMint: string;
      tokenSymbol: string | null;
      currentPrice: number;
      entryPrice: number;
      pnlPct: number;
    }
  ): Promise<void> {
    // Throttle price updates to once per second per position
    const cacheKey = `price_update:${data.positionId}`;
    const lastUpdate = await redis.get(cacheKey);

    if (lastUpdate && Date.now() - parseInt(lastUpdate) < 1000) {
      return;
    }

    await redis.set(cacheKey, Date.now().toString(), 'EX', 5);

    await emitToUser(userId, 'price:update', data);
  }
}

// Singleton instance
export const automationWorker = new AutomationWorker();
