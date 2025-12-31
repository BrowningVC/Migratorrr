import { prisma } from '../db/client.js';
import { transactionExecutor } from '../services/transaction-executor.js';
import { emitToUser } from '../websocket/handlers.js';
import { redis } from '../db/redis.js';

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
   * Fetch prices for multiple tokens
   */
  private async fetchPrices(mints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const now = Date.now();

    // Check cache first (prices older than 200ms are stale)
    const cacheMisses: string[] = [];
    for (const mint of mints) {
      const cached = this.priceCache.get(mint);
      if (cached && now - cached.timestamp < 200) {
        prices.set(mint, cached.price);
      } else {
        cacheMisses.push(mint);
      }
    }

    if (cacheMisses.length === 0) {
      return prices;
    }

    // Fetch missing prices from Raydium/Jupiter
    try {
      const response = await fetch(
        `https://api.raydium.io/v2/main/price?tokens=${cacheMisses.join(',')}`
      );

      if (response.ok) {
        const data = await response.json();

        for (const mint of cacheMisses) {
          const price = data.data?.[mint];
          if (price) {
            prices.set(mint, price);
            this.priceCache.set(mint, { mint, price, timestamp: now });
          }
        }
      }
    } catch (error) {
      console.error('Price fetch error:', error);
    }

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
    if (trailingStopPct && highestPrice) {
      // Update highest price if current is higher
      if (currentPrice > highestPrice) {
        await prisma.position.update({
          where: { id },
          data: { highestPrice: currentPrice },
        });
      }

      // Check if price dropped by trailing stop percentage from highest
      const dropPct = ((highestPrice - currentPrice) / highestPrice) * 100;
      if (dropPct >= trailingStopPct) {
        console.log(`Trailing stop triggered for position ${id}`);
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

    // Notify user
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
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        sniperId: sniper.id,
        eventType: `position:${reason}`,
        eventData: {
          positionId: id,
          tokenMint,
          tokenSymbol,
          currentPrice,
          tokenAmount: currentTokenAmount,
        },
      },
    });

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
        slippageBps: config.slippageBps || 500, // 5% default slippage for sells
        priorityFeeSol: config.priorityFeeSol || 0.001,
        reason,
      });

      if (result.success) {
        await prisma.position.update({
          where: { id },
          data: {
            status: 'closed',
            closedAt: new Date(),
            exitPrice: currentPrice,
            exitSol: result.solSpent || 0,
          },
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
        // Revert to open status on failure
        await prisma.position.update({
          where: { id },
          data: { status: 'open' },
        });

        await emitToUser(userId, 'position:sell_failed', {
          positionId: id,
          tokenMint,
          tokenSymbol,
          reason,
          error: result.error,
        });

        console.error(`Failed to close position ${id}: ${result.error}`);
      }
    } catch (error) {
      // Revert to open status on error
      await prisma.position.update({
        where: { id },
        data: { status: 'open' },
      });

      console.error(`Error executing sell for position ${id}:`, error);
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
