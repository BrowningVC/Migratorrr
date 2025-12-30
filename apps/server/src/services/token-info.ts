import { redis } from '../db/redis.js';

interface TokenVolumeData {
  volumeUsd24h: number;
  volumeUsdTotal: number;
  fetchedAt: number;
}

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  txns: {
    h24: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    m5: { buys: number; sells: number };
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  pairCreatedAt?: number;
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

/**
 * TokenInfoService - Fetches token metadata from external APIs
 *
 * Used for filtering:
 * - Volume since deployment (from DexScreener)
 * - Token creation time (from MigrationEvent.timestamp)
 */
class TokenInfoService {
  private cachePrefix = 'token-volume:';
  private cacheTtlSeconds = 60; // Cache for 1 minute
  private dexScreenerBaseUrl = 'https://api.dexscreener.com/latest/dex';

  /**
   * Get volume data for a token from DexScreener
   * Returns the total 24h volume across all pairs
   */
  async getTokenVolume(tokenMint: string): Promise<TokenVolumeData | null> {
    // Check cache first
    const cacheKey = `${this.cachePrefix}${tokenMint}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as TokenVolumeData;
      } catch {
        // Invalid cache, continue to fetch
      }
    }

    try {
      // Fetch from DexScreener
      const response = await fetch(
        `${this.dexScreenerBaseUrl}/tokens/${tokenMint}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error(`DexScreener API error: ${response.status}`);
        return null;
      }

      const data: DexScreenerResponse = await response.json();

      if (!data.pairs || data.pairs.length === 0) {
        // Token not yet indexed by DexScreener (very new)
        // Return zero volume - this is expected for new tokens
        const zeroVolume: TokenVolumeData = {
          volumeUsd24h: 0,
          volumeUsdTotal: 0,
          fetchedAt: Date.now(),
        };

        // Cache for shorter time since it might get indexed soon
        await redis.setex(cacheKey, 30, JSON.stringify(zeroVolume));
        return zeroVolume;
      }

      // Sum volume across all Solana pairs for this token
      let totalVolume24h = 0;
      let totalVolumeAll = 0;

      for (const pair of data.pairs) {
        if (pair.chainId === 'solana') {
          // 24h volume
          totalVolume24h += pair.volume?.h24 || 0;

          // Total volume approximation: use 24h as baseline
          // DexScreener doesn't provide all-time volume, so we use 24h
          // For newly migrated tokens (< 24h old), this should be accurate
          totalVolumeAll += pair.volume?.h24 || 0;
        }
      }

      const volumeData: TokenVolumeData = {
        volumeUsd24h: totalVolume24h,
        volumeUsdTotal: totalVolumeAll,
        fetchedAt: Date.now(),
      };

      // Cache the result
      await redis.setex(cacheKey, this.cacheTtlSeconds, JSON.stringify(volumeData));

      return volumeData;
    } catch (error) {
      console.error(`Failed to fetch token volume for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Calculate migration time (time from token creation to migration)
   *
   * @param tokenCreationTimestamp - Token creation time (Unix timestamp in ms)
   * @param migrationDetectedAt - When the migration was detected (Unix timestamp in ms)
   * @returns Migration time in minutes
   */
  calculateMigrationTimeMinutes(
    tokenCreationTimestamp: number,
    migrationDetectedAt: number
  ): number {
    const diffMs = migrationDetectedAt - tokenCreationTimestamp;
    return Math.floor(diffMs / (1000 * 60)); // Convert to minutes
  }

  /**
   * Check if a token meets the migration time criteria
   *
   * @param tokenCreationTimestamp - Token creation time
   * @param migrationDetectedAt - Migration detection time
   * @param maxMigrationTimeMinutes - Maximum allowed migration time
   */
  meetsMigrationTimeCriteria(
    tokenCreationTimestamp: number,
    migrationDetectedAt: number,
    maxMigrationTimeMinutes: number
  ): boolean {
    const migrationTime = this.calculateMigrationTimeMinutes(
      tokenCreationTimestamp,
      migrationDetectedAt
    );
    return migrationTime <= maxMigrationTimeMinutes;
  }

  /**
   * Check if a token meets the volume criteria
   *
   * @param volumeData - Volume data from DexScreener
   * @param minVolumeUsd - Minimum required volume in USD
   */
  meetsVolumeCriteria(
    volumeData: TokenVolumeData | null,
    minVolumeUsd: number
  ): boolean {
    if (!volumeData) {
      // If we can't fetch volume data, fail open (allow the trade)
      // This prevents blocking trades due to API issues
      console.warn('Volume data unavailable, allowing trade');
      return true;
    }

    return volumeData.volumeUsdTotal >= minVolumeUsd;
  }

  /**
   * Clear the volume cache for a specific token
   */
  async clearCache(tokenMint: string): Promise<void> {
    const cacheKey = `${this.cachePrefix}${tokenMint}`;
    await redis.del(cacheKey);
  }
}

// Singleton instance
export const tokenInfoService = new TokenInfoService();
