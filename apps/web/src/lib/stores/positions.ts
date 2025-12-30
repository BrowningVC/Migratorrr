import { create } from 'zustand';

export interface Position {
  id: string;
  tokenMint: string;
  tokenSymbol: string | null;
  tokenName?: string;
  entrySol: number;
  entryPrice: number;
  entryTokenAmount: number;
  currentTokenAmount: number;
  currentPrice?: number;
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
    set((state) => ({
      positions: state.positions.map((p) => {
        if (p.tokenMint !== tokenMint) return p;
        const pnlPct = ((price - p.entryPrice) / p.entryPrice) * 100;
        const pnlSol = (price - p.entryPrice) * p.currentTokenAmount;
        return {
          ...p,
          currentPrice: price,
          pnlPct,
          pnlSol,
          highestPrice: Math.max(p.highestPrice || price, price),
        };
      }),
    })),
}));
