import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Position {
  id: string;
  tokenMint: string;
  tokenSymbol: string | null;
  tokenName?: string;
  entrySol: number;
  entryPrice: number;
  entryTokenAmount: number;
  entryMarketCap?: number | null;
  currentTokenAmount: number;
  currentPrice?: number;
  currentMarketCap?: number | null;
  pnlPct?: number;
  pnlSol?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  trailingStopPct?: number;
  highestPrice?: number;
  exitSol?: number; // SOL received when position closed
  exitPrice?: number; // Price at exit
  status: 'open' | 'selling' | 'closed';
  createdAt: string;
  closedAt?: string;
}

interface PositionsState {
  positions: Position[];
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  setPositions: (positions: Position[]) => void;
  addPosition: (position: Position) => void;
  updatePosition: (id: string, updates: Partial<Position>) => void;
  removePosition: (id: string) => void;
  updatePrice: (tokenMint: string, price: number) => void;
  mergePositions: (apiPositions: Position[]) => void;
}

export const usePositionsStore = create<PositionsState>()(
  persist(
    (set) => ({
      positions: [],
      _hasHydrated: false,

      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },

      setPositions: (positions) => set({ positions }),

      addPosition: (position) =>
        set((state) => {
          // Check if position already exists
          const exists = state.positions.some((p) => p.id === position.id);
          if (exists) return state;
          return { positions: [position, ...state.positions] };
        }),

      updatePosition: (id, updates) =>
        set((state) => ({
          positions: state.positions.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      removePosition: (id) =>
        set((state) => ({
          positions: state.positions.filter((p) => p.id !== id),
        })),

      updatePrice: (tokenMint, price) =>
        set((state) => {
          // Find index for O(n) search once, then O(1) update
          const idx = state.positions.findIndex((p) => p.tokenMint === tokenMint);
          if (idx === -1) return state; // No matching position, skip update

          const p = state.positions[idx];
          // Skip if price hasn't changed meaningfully (< 0.01% change)
          if (p.currentPrice && Math.abs(price - p.currentPrice) / p.currentPrice < 0.0001) {
            return state;
          }

          const pnlPct = ((price - p.entryPrice) / p.entryPrice) * 100;
          const pnlSol = (price - p.entryPrice) * p.currentTokenAmount;

          // Calculate current market cap based on price change ratio from entry
          const currentMarketCap = p.entryMarketCap && p.entryPrice > 0
            ? p.entryMarketCap * (price / p.entryPrice)
            : null;

          const updated = {
            ...p,
            currentPrice: price,
            currentMarketCap,
            pnlPct,
            pnlSol,
            highestPrice: Math.max(p.highestPrice || price, price),
          };

          // Create new array with only the changed position
          const newPositions = [...state.positions];
          newPositions[idx] = updated;
          return { positions: newPositions };
        }),

      // Merge API positions with existing local positions
      // - Updates existing positions with API data (API is source of truth for status)
      // - Adds new positions from API that don't exist locally
      // - Keeps local positions that are open but not in API (race condition protection)
      // - Removes positions only if API says they're closed
      mergePositions: (apiPositions) =>
        set((state) => {
          const apiPositionMap = new Map(apiPositions.map((p) => [p.id, p]));
          const existingIds = new Set(state.positions.map((p) => p.id));

          // Start with existing positions, updating them with API data
          const mergedPositions: Position[] = [];

          // Process existing positions
          for (const existing of state.positions) {
            const apiVersion = apiPositionMap.get(existing.id);

            if (apiVersion) {
              // Position exists in both - use API data but preserve local price updates
              mergedPositions.push({
                ...apiVersion,
                // Keep local real-time price data if available
                currentPrice: existing.currentPrice ?? apiVersion.currentPrice,
                currentMarketCap: existing.currentMarketCap ?? apiVersion.currentMarketCap,
                pnlPct: existing.pnlPct ?? apiVersion.pnlPct,
                pnlSol: existing.pnlSol ?? apiVersion.pnlSol,
                highestPrice: existing.highestPrice ?? apiVersion.highestPrice,
              });
            } else if (existing.status === 'open' || existing.status === 'selling') {
              // Position is open locally but not in API - keep it (race condition protection)
              // This handles the case where WebSocket added it before API returned
              mergedPositions.push(existing);
            }
            // If position is closed locally and not in API, drop it (already cleaned up)
          }

          // Add new positions from API that don't exist locally
          for (const apiPosition of apiPositions) {
            if (!existingIds.has(apiPosition.id)) {
              mergedPositions.push(apiPosition);
            }
          }

          // Sort by createdAt (newest first) to maintain consistent order
          mergedPositions.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

          return { positions: mergedPositions };
        }),
    }),
    {
      name: 'migratorrr-positions',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
