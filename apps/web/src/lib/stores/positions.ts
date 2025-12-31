import { create } from 'zustand';

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
  status: 'open' | 'selling' | 'closed';
  createdAt: string;
}

interface PositionsState {
  positions: Position[];
  setPositions: (positions: Position[]) => void;
  addPosition: (position: Position) => void;
  updatePosition: (id: string, updates: Partial<Position>) => void;
  removePosition: (id: string) => void;
  updatePrice: (tokenMint: string, price: number) => void;
}

export const usePositionsStore = create<PositionsState>((set) => ({
  positions: [],

  setPositions: (positions) => set({ positions }),

  addPosition: (position) =>
    set((state) => ({
      positions: [position, ...state.positions],
    })),

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
}));
