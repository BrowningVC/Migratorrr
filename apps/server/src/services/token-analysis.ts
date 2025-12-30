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
}

export interface TokenAnalysis {
  tokenMint: string;
  holderCount: number;
  devHoldingsPct: number;
  top10HoldingsPct: number;
  socials: TokenSocials;
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
      // Fetch holder data and socials in parallel
      const [holderData, socials] = await Promise.all([
        this.getHolderData(tokenMint),
        this.getTokenSocials(tokenMint),
      ]);

      if (!holderData) {
        return null;
      }

      const analysis: TokenAnalysis = {
        tokenMint,
        holderCount: holderData.holderCount,
        devHoldingsPct: holderData.devHoldingsPct,
        top10HoldingsPct: holderData.top10HoldingsPct,
        socials,
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
   * Get social links from DexScreener
   */
  private async getTokenSocials(tokenMint: string): Promise<TokenSocials> {
    const defaultSocials: TokenSocials = {
      twitter: null,
      telegram: null,
      website: null,
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
        return defaultSocials;
      }

      const data: DexScreenerResponse = await response.json();

      if (!data.pairs || data.pairs.length === 0) {
        return defaultSocials;
      }

      // Find the pair with social info
      for (const pair of data.pairs) {
        if (pair.info) {
          // Extract website
          if (pair.info.websites && pair.info.websites.length > 0) {
            defaultSocials.website = pair.info.websites[0].url;
          }

          // Extract socials
          if (pair.info.socials) {
            for (const social of pair.info.socials) {
              if (social.type === 'twitter') {
                defaultSocials.twitter = social.url;
              } else if (social.type === 'telegram') {
                defaultSocials.telegram = social.url;
              }
            }
          }

          // If we found info, break
          if (defaultSocials.twitter || defaultSocials.telegram || defaultSocials.website) {
            break;
          }
        }
      }

      return defaultSocials;
    } catch (error) {
      console.error(`Failed to fetch socials for ${tokenMint}:`, error);
      return defaultSocials;
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
   * Clear cache for a specific token
   */
  async clearCache(tokenMint: string): Promise<void> {
    const cacheKey = `${this.cachePrefix}${tokenMint}`;
    await redis.del(cacheKey);
  }
}

// Singleton instance
export const tokenAnalysisService = new TokenAnalysisService();
