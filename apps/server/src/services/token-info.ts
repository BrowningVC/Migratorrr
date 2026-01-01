import { redis } from '../db/redis.js';

interface TokenVolumeData {
  volumeUsd24h: number;
  volumeUsdTotal: number;
  fetchedAt: number;
}

interface TokenMarketData {
  marketCapUsd: number;
  priceUsd: number;
  liquidityUsd: number;
  fetchedAt: number;
}

interface TokenMetadata {
  symbol: string | null;
  name: string | null;
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
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
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
  private cacheTtlSeconds = 120; // Cache for 2 minutes (was 1)
  private dexScreenerBaseUrl = 'https://api.dexscreener.com/latest/dex';

  // Rate limiting for DexScreener API
  private lastDexScreenerCall = 0;
  private readonly DEXSCREENER_MIN_INTERVAL_MS = 100; // Max 10 calls/second

  /**
   * Rate-limited delay for DexScreener API calls
   */
  private async rateLimitDexScreener(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastDexScreenerCall;
    if (elapsed < this.DEXSCREENER_MIN_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.DEXSCREENER_MIN_INTERVAL_MS - elapsed));
    }
    this.lastDexScreenerCall = Date.now();
  }

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

    // Rate limit API calls
    await this.rateLimitDexScreener();

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
   * Get market data for a token from DexScreener
   * Returns market cap, price, and liquidity
   */
  async getTokenMarketData(tokenMint: string): Promise<TokenMarketData | null> {
    const cacheKey = `token-market:${tokenMint}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as TokenMarketData;
      } catch {
        // Invalid cache, continue to fetch
      }
    }

    // Rate limit API calls
    await this.rateLimitDexScreener();

    try {
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
        return null;
      }

      // Get market data from the first Solana pair (usually Raydium)
      let marketCapUsd = 0;
      let priceUsd = 0;
      let liquidityUsd = 0;

      for (const pair of data.pairs) {
        if (pair.chainId === 'solana') {
          // Use the highest market cap found
          if (pair.marketCap && pair.marketCap > marketCapUsd) {
            marketCapUsd = pair.marketCap;
          }
          // Use fdv as fallback
          if (!marketCapUsd && pair.fdv && pair.fdv > marketCapUsd) {
            marketCapUsd = pair.fdv;
          }
          // Get price from first valid pair
          if (!priceUsd && pair.priceUsd) {
            priceUsd = parseFloat(pair.priceUsd);
          }
          // Sum liquidity across pairs
          liquidityUsd += pair.liquidity?.usd || 0;
        }
      }

      const marketData: TokenMarketData = {
        marketCapUsd,
        priceUsd,
        liquidityUsd,
        fetchedAt: Date.now(),
      };

      // Cache for 30 seconds (market data changes frequently)
      await redis.setex(cacheKey, 30, JSON.stringify(marketData));

      return marketData;
    } catch (error) {
      console.error(`Failed to fetch market data for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Check if a token meets the market cap criteria
   *
   * @param marketData - Market data from DexScreener
   * @param maxMarketCapUsd - Maximum allowed market cap in USD
   */
  meetsMarketCapCriteria(
    marketData: TokenMarketData | null,
    maxMarketCapUsd: number
  ): boolean {
    if (!marketData) {
      // If we can't fetch market data, fail open (allow the trade)
      // For new migrations, DexScreener may not have data yet
      console.warn('Market data unavailable, allowing trade');
      return true;
    }

    // If market cap is 0, it's likely a very new token - allow it
    if (marketData.marketCapUsd === 0) {
      return true;
    }

    return marketData.marketCapUsd <= maxMarketCapUsd;
  }

  /**
   * Get token metadata (symbol and name) from multiple sources
   * Tries Jupiter first (fastest for new tokens), then DexScreener
   */
  async getTokenMetadata(tokenMint: string): Promise<TokenMetadata | null> {
    const cacheKey = `token-meta:${tokenMint}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as TokenMetadata;
      } catch {
        // Invalid cache, continue to fetch
      }
    }

    // Try Jupiter first (indexes faster than DexScreener)
    const jupiterMeta = await this.getTokenMetadataFromJupiter(tokenMint);
    if (jupiterMeta?.symbol) {
      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(jupiterMeta));
      return jupiterMeta;
    }

    // Fall back to DexScreener
    await this.rateLimitDexScreener();

    try {
      const response = await fetch(
        `${this.dexScreenerBaseUrl}/tokens/${tokenMint}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data: DexScreenerResponse = await response.json();

      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      // Find the token in the pairs (could be base or quote)
      let symbol: string | null = null;
      let name: string | null = null;

      for (const pair of data.pairs) {
        if (pair.chainId === 'solana') {
          if (pair.baseToken.address === tokenMint) {
            symbol = pair.baseToken.symbol;
            name = pair.baseToken.name;
            break;
          }
          if (pair.quoteToken.address === tokenMint) {
            symbol = pair.quoteToken.symbol;
            name = pair.quoteToken.name;
            break;
          }
        }
      }

      const metadata: TokenMetadata = {
        symbol,
        name,
        fetchedAt: Date.now(),
      };

      // Cache for 5 minutes (metadata rarely changes)
      if (symbol) {
        await redis.setex(cacheKey, 300, JSON.stringify(metadata));
      }

      return metadata;
    } catch (error) {
      console.error(`Failed to fetch token metadata for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Get token metadata from Jupiter Token API (faster for new tokens)
   */
  private async getTokenMetadataFromJupiter(tokenMint: string): Promise<TokenMetadata | null> {
    try {
      const response = await fetch(
        `https://tokens.jup.ag/token/${tokenMint}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (!data || !data.symbol) {
        return null;
      }

      return {
        symbol: data.symbol || null,
        name: data.name || null,
        fetchedAt: Date.now(),
      };
    } catch {
      // Jupiter API failed, will fall back to DexScreener
      return null;
    }
  }

  /**
   * Clear the volume cache for a specific token
   */
  async clearCache(tokenMint: string): Promise<void> {
    const cacheKey = `${this.cachePrefix}${tokenMint}`;
    await redis.del(cacheKey);
    await redis.del(`token-market:${tokenMint}`);
    await redis.del(`token-meta:${tokenMint}`);
  }
}

// Singleton instance
export const tokenInfoService = new TokenInfoService();
