import { redis } from '../db/redis.js';

interface TokenHolder {
  address: string;
  amount: number;
  percentage: number;
}

interface TokenSocials {
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  twitterFollowers?: number | null;
}

interface CreatorHistory {
  totalTokensCreated: number;
  ruggedTokens: number;
  successfulTokens: number; // Survived > 24h with positive price action
  isFirstTimeCreator: boolean;
  creatorScore: number; // 0-100, higher = more trustworthy
}

export interface TokenAnalysis {
  tokenMint: string;
  holderCount: number;
  devHoldingsPct: number;
  top10HoldingsPct: number;
  socials: TokenSocials;
  // New filter data
  creatorHistory?: CreatorHistory;
  isLiquidityLocked?: boolean;
  isDexScreenerPaid?: boolean;
  fetchedAt: number;
}

interface HeliusTokenHolder {
  owner: string;
  balance: number;
}

interface DexScreenerPair {
  baseToken: {
    address: string;
  };
  info?: {
    websites?: Array<{ url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
  // Liquidity info
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  // Boosts indicate DexScreener paid promotion
  boosts?: {
    active?: number;
  };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

/**
 * TokenAnalysisService - Fetches holder distribution and social data for tokens
 *
 * Uses:
 * - Helius API for holder data (getTokenAccounts)
 * - DexScreener API for social links
 */
class TokenAnalysisService {
  private cachePrefix = 'token-analysis:';
  private cacheTtlSeconds = 1800; // Cache for 30 minutes (was 10) - reduces Helius getTokenAccounts calls
  private heliusApiKey = process.env.HELIUS_API_KEY || '';
  private heliusRpcUrl = process.env.HELIUS_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
  private dexScreenerBaseUrl = 'https://api.dexscreener.com/latest/dex';

  // Rate limiting for Helius API
  private lastHeliusCall = 0;
  private readonly HELIUS_MIN_INTERVAL_MS = 200; // Max 5 calls/second

  /**
   * Get comprehensive token analysis including holders, dev holdings, and socials
   */
  async getTokenAnalysis(tokenMint: string): Promise<TokenAnalysis | null> {
    // Check cache first
    const cacheKey = `${this.cachePrefix}${tokenMint}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as TokenAnalysis;
      } catch {
        // Invalid cache, continue to fetch
      }
    }

    try {
      // Fetch holder data and DexScreener data in parallel
      const [holderData, dexScreenerData] = await Promise.all([
        this.getHolderData(tokenMint),
        this.getDexScreenerData(tokenMint),
      ]);

      if (!holderData) {
        return null;
      }

      const analysis: TokenAnalysis = {
        tokenMint,
        holderCount: holderData.holderCount,
        devHoldingsPct: holderData.devHoldingsPct,
        top10HoldingsPct: holderData.top10HoldingsPct,
        socials: dexScreenerData.socials,
        isLiquidityLocked: dexScreenerData.isLiquidityLocked,
        isDexScreenerPaid: dexScreenerData.isDexScreenerPaid,
        fetchedAt: Date.now(),
      };

      // Cache the result
      await redis.setex(cacheKey, this.cacheTtlSeconds, JSON.stringify(analysis));

      return analysis;
    } catch (error) {
      console.error(`Failed to get token analysis for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Rate-limited delay for Helius API calls
   */
  private async rateLimitHelius(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastHeliusCall;
    if (elapsed < this.HELIUS_MIN_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.HELIUS_MIN_INTERVAL_MS - elapsed));
    }
    this.lastHeliusCall = Date.now();
  }

  /**
   * Get holder distribution data from Helius
   */
  private async getHolderData(tokenMint: string): Promise<{
    holderCount: number;
    devHoldingsPct: number;
    top10HoldingsPct: number;
  } | null> {
    if (!this.heliusApiKey) {
      console.warn('HELIUS_API_KEY not set, skipping holder analysis');
      return null;
    }

    // Rate limit Helius calls
    await this.rateLimitHelius();

    try {
      // Use Helius getTokenAccounts - reduced limit to save credits
      const response = await fetch(this.heliusRpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'holder-analysis',
          method: 'getTokenAccounts',
          params: {
            mint: tokenMint,
            limit: 100, // Reduced from 1000 - we only need top holders for concentration check
          },
        }),
      });

      if (!response.ok) {
        console.error(`Helius API error: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.error) {
        console.error('Helius API error:', data.error);
        return null;
      }

      const tokenAccounts: HeliusTokenHolder[] = data.result?.token_accounts || [];

      if (tokenAccounts.length === 0) {
        return {
          holderCount: 0,
          devHoldingsPct: 0,
          top10HoldingsPct: 0,
        };
      }

      // Calculate total supply from all holders
      const totalSupply = tokenAccounts.reduce((sum, h) => sum + h.balance, 0);

      if (totalSupply === 0) {
        return {
          holderCount: tokenAccounts.length,
          devHoldingsPct: 0,
          top10HoldingsPct: 0,
        };
      }

      // Sort by balance descending
      const sortedHolders = tokenAccounts.sort((a, b) => b.balance - a.balance);

      // Dev wallet is typically the largest holder (first holder)
      const devHoldingsPct = (sortedHolders[0]?.balance || 0) / totalSupply * 100;

      // Calculate top 10 concentration
      const top10Balance = sortedHolders.slice(0, 10).reduce((sum, h) => sum + h.balance, 0);
      const top10HoldingsPct = top10Balance / totalSupply * 100;

      return {
        holderCount: tokenAccounts.length,
        devHoldingsPct: Math.round(devHoldingsPct * 10) / 10,
        top10HoldingsPct: Math.round(top10HoldingsPct * 10) / 10,
      };
    } catch (error) {
      console.error(`Failed to fetch holder data for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Get comprehensive DexScreener data including socials, liquidity lock status, and paid status
   */
  private async getDexScreenerData(tokenMint: string): Promise<{
    socials: TokenSocials;
    isLiquidityLocked: boolean;
    isDexScreenerPaid: boolean;
  }> {
    const defaultResult = {
      socials: {
        twitter: null,
        telegram: null,
        website: null,
        twitterFollowers: null,
      } as TokenSocials,
      isLiquidityLocked: false,
      isDexScreenerPaid: false,
    };

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
        return defaultResult;
      }

      const data: DexScreenerResponse = await response.json();

      if (!data.pairs || data.pairs.length === 0) {
        return defaultResult;
      }

      const socials: TokenSocials = {
        twitter: null,
        telegram: null,
        website: null,
        twitterFollowers: null,
      };
      let isLiquidityLocked = false;
      let isDexScreenerPaid = false;

      // Find the pair with the most info (usually the main Raydium pair)
      for (const pair of data.pairs) {
        // Check for DexScreener paid boosts
        if (pair.boosts?.active && pair.boosts.active > 0) {
          isDexScreenerPaid = true;
        }

        if (pair.info) {
          // Extract website
          if (pair.info.websites && pair.info.websites.length > 0) {
            socials.website = pair.info.websites[0].url;
          }

          // Extract socials
          if (pair.info.socials) {
            for (const social of pair.info.socials) {
              if (social.type === 'twitter') {
                socials.twitter = social.url;
              } else if (social.type === 'telegram') {
                socials.telegram = social.url;
              }
            }
          }
        }
      }

      // Fetch Twitter follower count if Twitter URL exists
      if (socials.twitter) {
        socials.twitterFollowers = await this.getTwitterFollowerCount(socials.twitter);
      }

      // Check liquidity lock status via RugCheck or similar
      isLiquidityLocked = await this.checkLiquidityLocked(tokenMint);

      return {
        socials,
        isLiquidityLocked,
        isDexScreenerPaid,
      };
    } catch (error) {
      console.error(`Failed to fetch DexScreener data for ${tokenMint}:`, error);
      return defaultResult;
    }
  }

  /**
   * Check if liquidity is locked using RugCheck API
   */
  private async checkLiquidityLocked(tokenMint: string): Promise<boolean> {
    try {
      // RugCheck API provides LP lock status
      const response = await fetch(
        `https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report/summary`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        return false;
      }

      const data = await response.json();

      // RugCheck returns LP lock info in the markets array
      // If any market has locked liquidity (>10%), consider it locked
      if (data.markets && Array.isArray(data.markets)) {
        for (const market of data.markets) {
          if (market.lp?.lpLocked === true || (market.lp?.lpLockedPct && market.lp.lpLockedPct >= 10)) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      // Don't log error for every token - RugCheck may not have data
      return false;
    }
  }

  /**
   * Get Twitter follower count from handle
   * Note: This is a best-effort approximation using public data
   */
  private async getTwitterFollowerCount(twitterUrl: string): Promise<number | null> {
    try {
      // Extract handle from URL
      const match = twitterUrl.match(/(?:twitter\.com|x\.com)\/([^/?]+)/i);
      if (!match) {
        return null;
      }

      const handle = match[1];
      if (!handle || handle === 'home' || handle === 'search') {
        return null;
      }

      // Use a public Twitter follower count API (e.g., social-counts or similar)
      // For now, we'll skip this as it requires API keys or scraping
      // In production, you could use:
      // 1. Twitter API v2 with Bearer token
      // 2. A third-party service like socialblade
      // 3. Nitter scraping (unreliable)

      // Return null - filter will use presence check instead
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if token meets holder count criteria
   */
  meetsHolderCountCriteria(analysis: TokenAnalysis | null, minHolderCount: number): boolean {
    if (!analysis) {
      // If we can't fetch data, fail open (allow the trade)
      console.warn('Token analysis unavailable, allowing trade');
      return true;
    }
    return analysis.holderCount >= minHolderCount;
  }

  /**
   * Check if token meets dev holdings criteria
   */
  meetsDevHoldingsCriteria(analysis: TokenAnalysis | null, maxDevHoldingsPct: number): boolean {
    if (!analysis) {
      console.warn('Token analysis unavailable, allowing trade');
      return true;
    }
    return analysis.devHoldingsPct <= maxDevHoldingsPct;
  }

  /**
   * Check if token meets top 10 concentration criteria
   */
  meetsTop10Criteria(analysis: TokenAnalysis | null, maxTop10HoldingsPct: number): boolean {
    if (!analysis) {
      console.warn('Token analysis unavailable, allowing trade');
      return true;
    }
    return analysis.top10HoldingsPct <= maxTop10HoldingsPct;
  }

  /**
   * Check if token meets social presence criteria
   */
  meetsSocialCriteria(
    analysis: TokenAnalysis | null,
    requireTwitter: boolean,
    requireTelegram: boolean,
    requireWebsite: boolean
  ): boolean {
    if (!analysis) {
      // If we can't fetch data and socials are required, fail closed (reject)
      if (requireTwitter || requireTelegram || requireWebsite) {
        console.warn('Token analysis unavailable, socials required - rejecting');
        return false;
      }
      return true;
    }

    if (requireTwitter && !analysis.socials.twitter) {
      return false;
    }
    if (requireTelegram && !analysis.socials.telegram) {
      return false;
    }
    if (requireWebsite && !analysis.socials.website) {
      return false;
    }

    return true;
  }

  /**
   * Check if token meets Twitter follower count criteria
   */
  meetsTwitterFollowersCriteria(
    analysis: TokenAnalysis | null,
    minFollowers: number | null
  ): boolean {
    // If no minimum set, always pass
    if (!minFollowers || minFollowers <= 0) {
      return true;
    }

    if (!analysis) {
      // If we can't fetch data and followers are required, fail closed (reject)
      console.warn('Token analysis unavailable, Twitter followers required - rejecting');
      return false;
    }

    // If we couldn't fetch follower count, fail closed
    if (analysis.socials.twitterFollowers === null || analysis.socials.twitterFollowers === undefined) {
      // If Twitter exists but no follower count, we couldn't fetch it - allow with warning
      if (analysis.socials.twitter) {
        console.warn(`Could not verify Twitter followers for ${analysis.tokenMint}, allowing`);
        return true;
      }
      return false;
    }

    return analysis.socials.twitterFollowers >= minFollowers;
  }

  /**
   * Check if token meets liquidity lock criteria
   */
  meetsLiquidityLockCriteria(
    analysis: TokenAnalysis | null,
    requireLocked: boolean
  ): boolean {
    // If not required, always pass
    if (!requireLocked) {
      return true;
    }

    if (!analysis) {
      // If we can't fetch data and lock is required, fail closed (reject)
      console.warn('Token analysis unavailable, liquidity lock required - rejecting');
      return false;
    }

    return analysis.isLiquidityLocked === true;
  }

  /**
   * Check if token meets DexScreener paid criteria
   */
  meetsDexScreenerPaidCriteria(
    analysis: TokenAnalysis | null,
    requirePaid: boolean
  ): boolean {
    // If not required, always pass
    if (!requirePaid) {
      return true;
    }

    if (!analysis) {
      // If we can't fetch data and paid is required, fail closed (reject)
      console.warn('Token analysis unavailable, DexScreener paid required - rejecting');
      return false;
    }

    return analysis.isDexScreenerPaid === true;
  }

  /**
   * Check if token creator meets history score criteria
   * Note: Creator history requires additional tracking infrastructure
   * For now, returns true (pass) if creatorHistory is unavailable
   */
  meetsCreatorScoreCriteria(
    analysis: TokenAnalysis | null,
    minCreatorScore: number | null
  ): boolean {
    // If no minimum set, always pass
    if (!minCreatorScore || minCreatorScore <= 0) {
      return true;
    }

    if (!analysis || !analysis.creatorHistory) {
      // Creator history not available - fail open for now (allow)
      // In production, this would require tracking creator wallets
      console.warn('Creator history unavailable, skipping creator score check');
      return true;
    }

    return analysis.creatorHistory.creatorScore >= minCreatorScore;
  }

  /**
   * Clear cache for a specific token
   */
  async clearCache(tokenMint: string): Promise<void> {
    const cacheKey = `${this.cachePrefix}${tokenMint}`;
    await redis.del(cacheKey);
  }
}

// Singleton instance
export const tokenAnalysisService = new TokenAnalysisService();
