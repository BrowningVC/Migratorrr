import { create } from 'zustand';

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
  takeProfitPct?: number;
  stopLossPct?: number;
  trailingStopPct?: number;
  maxMarketCapUsd?: number;
  minLiquiditySol?: number;
  namePatterns?: string[];
  excludedPatterns?: string[];
  // Migration time filter (minutes from token creation to migration)
  maxMigrationTimeMinutes?: number; // 5, 15, 60, or 360
  // Volume filter (minimum volume in USD since token deployment)
  minVolumeUsd?: number; // 10000, 25000, 50000, or 100000
  // MEV Protection - use Jito bundles for sandwich attack protection
  mevProtection?: boolean;
}

interface SnipersState {
  snipers: Sniper[];
  setSnipers: (snipers: Sniper[]) => void;
  addSniper: (sniper: Sniper) => void;
  updateSniper: (id: string, updates: Partial<Sniper>) => void;
  removeSniper: (id: string) => void;
  toggleSniper: (id: string) => void;
}

export const useSnipersStore = create<SnipersState>((set) => ({
  snipers: [],

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
}));
