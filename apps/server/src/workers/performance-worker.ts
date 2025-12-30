import { performanceTracker } from '../services/performance-tracker.js';

/**
 * PerformanceWorker - Periodically updates token performance milestones
 *
 * Responsibilities:
 * 1. Monitor migrated tokens for price milestones (2x, 5x, 10x, etc.)
 * 2. Track highest prices and market caps
 * 3. Recalculate platform-wide statistics
 * 4. Detect rugged tokens (liquidity pulled)
 */
export class PerformanceWorker {
  private isRunning = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;

  // Update prices every 30 seconds
  private priceUpdateIntervalMs = 30 * 1000;
  // Recalculate stats every 5 minutes
  private statsUpdateIntervalMs = 5 * 60 * 1000;
  // Batch size for price updates
  private batchSize = 50;

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Performance worker already running');
      return;
    }

    this.isRunning = true;

    // Start the price update loop
    this.updateInterval = setInterval(
      () => this.runPriceUpdates().catch(console.error),
      this.priceUpdateIntervalMs
    );

    // Start the stats calculation loop
    this.statsInterval = setInterval(
      () => this.runStatsCalculation().catch(console.error),
      this.statsUpdateIntervalMs
    );

    // Run initial updates
    await this.runPriceUpdates();
    await this.runStatsCalculation();

    console.log('Performance Worker started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    console.log('Performance Worker stopped');
  }

  /**
   * Run a batch of price updates
   */
  private async runPriceUpdates(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const processed = await performanceTracker.processBatchUpdate(this.batchSize);
      if (processed > 0) {
        console.log(`Performance worker: Updated ${processed} migration prices`);
      }
    } catch (error) {
      console.error('Performance worker price update error:', error);
    }
  }

  /**
   * Recalculate platform statistics
   */
  private async runStatsCalculation(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Clear cache to force recalculation
      await performanceTracker.clearStatsCache();
      const stats = await performanceTracker.calculateStats();

      console.log(`Performance worker: Stats updated - ${stats.totalMigrations} migrations tracked`);
      console.log(`  2x: ${stats.pctReached2x.toFixed(1)}%, 5x: ${stats.pctReached5x.toFixed(1)}%, 10x: ${stats.pctReached10x.toFixed(1)}%`);

      if (stats.highestMultiplier > 0) {
        console.log(`  Highest: ${stats.highestMultiplier.toFixed(1)}x (${stats.highestMultiplierToken})`);
      }
    } catch (error) {
      console.error('Performance worker stats calculation error:', error);
    }
  }

  /**
   * Force an immediate stats recalculation
   */
  async forceStatsUpdate(): Promise<void> {
    await this.runStatsCalculation();
  }
}

// Singleton instance
export const performanceWorker = new PerformanceWorker();
