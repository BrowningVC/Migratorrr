const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string; // Additional error details from server
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // Start with 1 second delay
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504]; // Timeout, rate limit, server errors

/**
 * Delay helper with exponential backoff
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown, status?: number): boolean {
  // Network errors are retryable
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  // Certain HTTP status codes are retryable
  if (status && RETRYABLE_STATUS_CODES.includes(status)) {
    return true;
  }
  return false;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string | null,
  retryCount = 0
): Promise<ApiResponse<T>> {
  const headers: HeadersInit = {
    ...options.headers,
  };

  // Only set Content-Type for requests with a body
  if (options.body) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    // Check if we should retry on server errors
    if (!response.ok && isRetryableError(null, response.status) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_MS * Math.pow(2, retryCount); // Exponential backoff
      console.warn(`API call to ${endpoint} failed with ${response.status}, retrying in ${delayMs}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(delayMs);
      return fetchApi<T>(endpoint, options, token, retryCount + 1);
    }

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
        details: data.details,
      };
    }

    return data;
  } catch (error) {
    // Retry on network errors
    if (isRetryableError(error) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.warn(`API call to ${endpoint} failed with network error, retrying in ${delayMs}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(delayMs);
      return fetchApi<T>(endpoint, options, token, retryCount + 1);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

// Auth API
export const authApi = {
  getNonce: (walletAddress: string) =>
    fetchApi<{ nonce: string; message: string; expiresAt: number }>(
      '/api/auth/nonce',
      {
        method: 'POST',
        body: JSON.stringify({ walletAddress }),
      }
    ),

  verify: (walletAddress: string, signature: string, message: string) =>
    fetchApi<{ token: string; user: { id: string; walletAddress: string } }>(
      '/api/auth/verify',
      {
        method: 'POST',
        body: JSON.stringify({ walletAddress, signature, message }),
      }
    ),

  logout: (token: string) =>
    fetchApi('/api/auth/logout', { method: 'POST', body: '{}' }, token),
};

// Wallet API
// Note: Server returns data as array directly, not { wallets: [...] }
export const walletApi = {
  getAll: (token: string) =>
    fetchApi<Array<{
      id: string;
      publicKey: string;
      label: string | null;
      walletType: string;
      isPrimary: boolean;
      createdAt: string;
    }>>('/api/wallet', {}, token),

  connect: (token: string, publicKey: string, isPrimary?: boolean) =>
    fetchApi<{ wallet: unknown }>(
      '/api/wallet/connect',
      {
        method: 'POST',
        body: JSON.stringify({ publicKey, isPrimary }),
      },
      token
    ),

  // Server returns wallet object directly as data, not { wallet: {...} }
  generate: (token: string, label?: string) =>
    fetchApi<{
      id: string;
      publicKey: string;
      walletType: string;
      label: string | null;
      isPrimary: boolean;
      createdAt: string;
    }>(
      '/api/wallet/generate',
      {
        method: 'POST',
        body: JSON.stringify({ label }),
      },
      token
    ),

  exportKey: (token: string, walletId: string) =>
    fetchApi<{ privateKey: string }>(
      `/api/wallet/${walletId}/export`,
      { method: 'POST', body: '{}' },
      token
    ),

  setPrimary: (token: string, walletId: string) =>
    fetchApi(
      `/api/wallet/${walletId}/primary`,
      { method: 'POST', body: '{}' },
      token
    ),

  // Get all wallet balances
  getBalances: (token: string) =>
    fetchApi<Array<{
      walletId: string;
      publicKey: string;
      label: string | null;
      walletType: string;
      balanceLamports: number;
      balanceSol: number;
      error?: string;
    }>>('/api/wallet/balances', {}, token),

  // Get single wallet balance
  getBalance: (token: string, walletId: string) =>
    fetchApi<{
      walletId: string;
      publicKey: string;
      label: string | null;
      walletType: string;
      balanceLamports: number;
      balanceSol: number;
    }>(`/api/wallet/${walletId}/balance`, {}, token),

  // Withdraw SOL from generated wallet
  withdraw: (token: string, walletId: string, destinationAddress: string, amountSol: number) =>
    fetchApi<{
      signature: string;
      amountSol: number;
      destination: string;
      explorerUrl: string;
    }>(
      `/api/wallet/${walletId}/withdraw`,
      {
        method: 'POST',
        body: JSON.stringify({ destinationAddress, amountSol }),
      },
      token
    ),
};

// Sniper API
export const sniperApi = {
  getAll: (token: string) =>
    fetchApi<{ snipers: Array<{
      id: string;
      name: string;
      isActive: boolean;
      walletId: string;
      config: Record<string, unknown>;
      totalSnipes: number;
      successfulSnipes: number;
      failedSnipes: number;
      totalSolSpent: number;
      createdAt: string;
      updatedAt: string;
    }> }>('/api/sniper', {}, token),

  get: (token: string, sniperId: string) =>
    fetchApi<{ data: unknown }>(`/api/sniper/${sniperId}`, {}, token),

  create: (
    token: string,
    data: {
      walletId: string;
      name: string;
      config: Record<string, unknown>;
      isActive?: boolean;
    }
  ) =>
    // Server returns sniper object directly as data
    fetchApi<{
      id: string;
      name: string;
      isActive: boolean;
      config: Record<string, unknown>;
      walletId: string;
      createdAt: string;
      updatedAt: string;
    }>(
      '/api/sniper',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      token
    ),

  update: (
    token: string,
    sniperId: string,
    data: {
      name?: string;
      config?: Record<string, unknown>;
      isActive?: boolean;
    }
  ) =>
    fetchApi(
      `/api/sniper/${sniperId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
      token
    ),

  toggle: (token: string, sniperId: string) =>
    fetchApi<{ data: { id: string; isActive: boolean } }>(
      `/api/sniper/${sniperId}/toggle`,
      { method: 'POST', body: '{}' },
      token
    ),

  delete: (token: string, sniperId: string) =>
    fetchApi(
      `/api/sniper/${sniperId}`,
      { method: 'DELETE' },
      token
    ),

  getStats: (token: string, sniperId: string) =>
    fetchApi<{ data: unknown }>(`/api/sniper/${sniperId}/stats`, {}, token),

  getActivity: (token: string, limit = 50) =>
    fetchApi<Array<{
      id: string;
      eventType: string;
      eventData: Record<string, unknown>;
      timestamp: string;
    }>>(`/api/sniper/activity?limit=${limit}`, {}, token),
};

// Position API
export const positionApi = {
  getAll: (token: string, status?: 'open' | 'closed' | 'all') =>
    fetchApi<{ items: Array<{
      id: string;
      tokenMint: string;
      tokenSymbol: string | null;
      tokenName: string | null;
      entryPrice: number;
      entryTokenAmount: number;
      entrySol: number;
      entryMarketCap: number | null;
      currentTokenAmount: number;
      status: string;
      takeProfitPrice: number | null;
      stopLossPrice: number | null;
      trailingStopPct: number | null;
      highestPrice: number | null;
      createdAt: string;
      closedAt: string | null;
    }>; total: number; page: number; pageSize: number; hasMore: boolean }>(
      `/api/position${status ? `?status=${status}` : ''}`,
      {},
      token
    ),

  get: (token: string, positionId: string) =>
    fetchApi<{ data: unknown }>(`/api/position/${positionId}`, {}, token),

  close: (token: string, positionId: string) =>
    fetchApi(
      `/api/position/${positionId}/close`,
      { method: 'POST', body: '{}' },
      token
    ),

  updateMetadata: (
    token: string,
    positionId: string,
    metadata: { tokenSymbol?: string; tokenName?: string; entryMarketCap?: number }
  ) =>
    fetchApi(
      `/api/position/${positionId}/metadata`,
      { method: 'PATCH', body: JSON.stringify(metadata) },
      token
    ),

  getPortfolio: (token: string) =>
    fetchApi<{ data: unknown }>('/api/position/portfolio/summary', {}, token),

  getActivity: (token: string, page?: number) =>
    fetchApi<{ data: { items: unknown[]; total: number } }>(
      `/api/position/activity/log${page ? `?page=${page}` : ''}`,
      {},
      token
    ),
};

// Stats API (public endpoints, no auth required)
export const statsApi = {
  getPlatformStats: () =>
    fetchApi<{
      totalMigrations: number;
      performance: {
        pct2x: number;
        pct5x: number;
        pct10x: number;
        pct50x: number;
        pct100x: number;
      };
      topPerformers: {
        highestMultiplier: number;
        highestMultiplierToken: string | null;
        highestMarketCap: number;
        highestMarketCapToken: string | null;
      };
      avgTimeToReach2x: number | null;
      lastUpdated: string;
    }>('/api/stats/platform'),

  getTopPerformers: () =>
    fetchApi<Array<{
      tokenSymbol: string;
      tokenName: string | null;
      tokenMint: string;
      multiplier: number;
      highestMarketCap: number | null;
      reached10x: boolean;
      reached100x: boolean;
      migrationDate: string;
      volumeUsd24h: number | null;
      holderCount: number | null;
      isVerified: boolean;
    }>>('/api/stats/top-performers'),

  getRecentMigrations: () =>
    fetchApi<Array<{
      tokenSymbol: string;
      tokenName: string | null;
      tokenMint: string;
      initialLiquidity: number | null;
      initialMarketCap: number | null;
      milestones: {
        reached2x: boolean;
        reached5x: boolean;
        reached10x: boolean;
      };
      snipedCount: number;
      migrationTime: string;
    }>>('/api/stats/recent-migrations'),

  // Get PumpFun migrations for dashboard Activity Log
  getPumpFunMigrations: (limit = 50) =>
    fetchApi<Array<{
      id: string;
      tokenMint: string;
      tokenSymbol: string | null;
      tokenName: string | null;
      poolAddress: string | null;
      detectionLatencyMs: number | null;
      source: string;
      timestamp: string;
      sniped: boolean;
      snipeSuccess?: boolean;
    }>>(`/api/stats/pumpfun-migrations?limit=${limit}`),
};
