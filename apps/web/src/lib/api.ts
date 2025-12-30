const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string | null
): Promise<ApiResponse<T>> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    return data;
  } catch (error) {
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
    fetchApi('/api/auth/logout', { method: 'POST' }, token),
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
      { method: 'POST' },
      token
    ),

  setPrimary: (token: string, walletId: string) =>
    fetchApi(
      `/api/wallet/${walletId}/primary`,
      { method: 'POST' },
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
      { method: 'POST' },
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
};

// Position API
export const positionApi = {
  getAll: (token: string, status?: 'open' | 'closed' | 'all') =>
    fetchApi<{ positions: Array<{
      id: string;
      tokenMint: string;
      tokenSymbol: string | null;
      tokenName: string | null;
      entryPrice: number;
      entryTokenAmount: number;
      entrySol: number;
      currentTokenAmount: number;
      status: string;
      takeProfitPrice: number | null;
      stopLossPrice: number | null;
      trailingStopPct: number | null;
      highestPrice: number | null;
      createdAt: string;
      closedAt: string | null;
    }> }>(
      `/api/position${status ? `?status=${status}` : ''}`,
      {},
      token
    ),

  get: (token: string, positionId: string) =>
    fetchApi<{ data: unknown }>(`/api/position/${positionId}`, {}, token),

  close: (token: string, positionId: string) =>
    fetchApi(
      `/api/position/${positionId}/close`,
      { method: 'POST' },
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
