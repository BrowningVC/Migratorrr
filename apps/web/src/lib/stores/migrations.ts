import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Migration {
  id: string;
  tokenMint: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  poolAddress?: string;
  detectionLatencyMs?: number;
  source?: string;
  timestamp: string;
  // Snipe tracking
  sniped: boolean;
  snipeSuccess?: boolean;
  snipeError?: string;
  sniperId?: string;
  sniperName?: string;
}

interface MigrationsState {
  migrations: Migration[];
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  addMigration: (migration: Omit<Migration, 'id' | 'sniped'>) => void;
  setMigrations: (migrations: Migration[]) => void;
  updateMigrationSnipeStatus: (
    tokenMint: string,
    status: { sniped: boolean; snipeSuccess?: boolean; snipeError?: string; sniperId?: string; sniperName?: string }
  ) => void;
  updateMigrationMetadata: (
    tokenMint: string,
    metadata: { tokenSymbol?: string; tokenName?: string }
  ) => void;
  clearMigrations: () => void;
}

// Helper to check if token is from PumpFun (ends with 'pump')
export function isPumpFunToken(tokenMint: string): boolean {
  return tokenMint.toLowerCase().endsWith('pump');
}

export const useMigrationsStore = create<MigrationsState>()(
  persist(
    (set, get) => ({
      migrations: [],
      _hasHydrated: false,

      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },

      addMigration: (migration) =>
        set((state) => {
          // Only add PumpFun tokens
          if (!isPumpFunToken(migration.tokenMint)) {
            return state;
          }

          // Check if migration already exists (by tokenMint)
          const exists = state.migrations.some((m) => m.tokenMint === migration.tokenMint);
          if (exists) return state;

          return {
            migrations: [
              {
                ...migration,
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                sniped: false,
              },
              ...state.migrations,
            ].slice(0, 100), // Keep last 100 migrations
          };
        }),

      setMigrations: (migrations) =>
        set({
          // Filter to only PumpFun tokens and dedupe
          migrations: migrations
            .filter((m) => isPumpFunToken(m.tokenMint))
            .slice(0, 100),
        }),

      updateMigrationSnipeStatus: (tokenMint, status) =>
        set((state) => ({
          migrations: state.migrations.map((m) =>
            m.tokenMint === tokenMint ? { ...m, ...status } : m
          ),
        })),

      updateMigrationMetadata: (tokenMint, metadata) =>
        set((state) => ({
          migrations: state.migrations.map((m) =>
            m.tokenMint === tokenMint
              ? {
                  ...m,
                  tokenSymbol: metadata.tokenSymbol || m.tokenSymbol,
                  tokenName: metadata.tokenName || m.tokenName,
                }
              : m
          ),
        })),

      clearMigrations: () => set({ migrations: [] }),
    }),
    {
      name: 'migratorrr-migrations',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
