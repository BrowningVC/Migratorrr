import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Sniper {
  id: string;
  name: string;
  isActive: boolean;
  walletId: string;
  config: SniperConfig;
  stats: {
    totalSnipes: number;
    successfulSnipes: number;
    failedSnipes: number;
    totalSolSpent: number;
    totalSolProfit: number;
    tokensFiltered?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SniperConfig {
  snipeAmountSol: number;
  slippageBps: number;
  priorityFeeSol: number;
  takeProfitPct: number; // Required - when to take profit (e.g., 100 = 2x)
  stopLossPct: number; // Required - max loss before selling (e.g., 50 = -50%)
  trailingStopPct?: number; // Optional - sell when drops X% from peak
  coverInitials?: boolean; // Sell 50% at 2x to cover initial investment
  maxMarketCapUsd?: number;
  namePatterns?: string[];
  excludedPatterns?: string[];
  // Migration time filter (minutes from token creation to migration)
  maxMigrationTimeMinutes?: number; // 5, 15, 60, or 360
  // Volume filter (minimum volume in USD since token deployment)
  minVolumeUsd?: number; // 10000, 25000, 50000, or 100000
  // MEV Protection - use Jito bundles for sandwich attack protection
  mevProtection?: boolean;
  // Holder count filter - minimum unique holders
  minHolderCount?: number; // 25, 50, 100, 250
  // Dev wallet holdings filter - max % of supply held by dev/creator
  maxDevHoldingsPct?: number; // 5, 15, 30, 50
  // Social presence filters
  requireTwitter?: boolean;
  requireTelegram?: boolean;
  requireWebsite?: boolean;
  // Top 10 wallet concentration - max % of supply held by top 10 wallets
  maxTop10HoldingsPct?: number; // 30, 50, 70, 90
  // NEW FILTERS
  // Twitter follower count - minimum followers required
  minTwitterFollowers?: number; // 100, 500, 1000, 5000
  // Liquidity lock - require LP tokens to be locked
  requireLiquidityLock?: boolean;
  // DexScreener paid - require token to have paid DexScreener promotion
  requireDexScreenerPaid?: boolean;
  // Creator history score - minimum trust score (0-100)
  minCreatorScore?: number; // 25, 50, 75
}

interface SnipersState {
  snipers: Sniper[];
  _hasHydrated: boolean;
  setSnipers: (snipers: Sniper[]) => void;
  addSniper: (sniper: Sniper) => void;
  updateSniper: (id: string, updates: Partial<Sniper>) => void;
  removeSniper: (id: string) => void;
  toggleSniper: (id: string) => void;
  setHasHydrated: (state: boolean) => void;
}

export const useSnipersStore = create<SnipersState>()(
  persist(
    (set) => ({
      snipers: [],
      _hasHydrated: false,

      setSnipers: (snipers) => set({ snipers }),

      addSniper: (sniper) =>
        set((state) => ({
          snipers: [...state.snipers, sniper],
        })),

      updateSniper: (id, updates) =>
        set((state) => ({
          snipers: state.snipers.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        })),

      removeSniper: (id) =>
        set((state) => ({
          snipers: state.snipers.filter((s) => s.id !== id),
        })),

      toggleSniper: (id) =>
        set((state) => ({
          snipers: state.snipers.map((s) =>
            s.id === id ? { ...s, isActive: !s.isActive } : s
          ),
        })),

      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'migratorrr-snipers',
      partialize: (state) => ({
        snipers: state.snipers,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
