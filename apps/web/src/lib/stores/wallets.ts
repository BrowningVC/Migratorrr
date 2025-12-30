import { create } from 'zustand';

export interface Wallet {
  id: string;
  publicKey: string;
  label: string | null;
  walletType: 'connected' | 'generated';
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
}

interface WalletsState {
  wallets: Wallet[];
  selectedWalletId: string | null;
  setWallets: (wallets: Wallet[]) => void;
  addWallet: (wallet: Wallet) => void;
  updateWallet: (id: string, updates: Partial<Wallet>) => void;
  removeWallet: (id: string) => void;
  selectWallet: (id: string) => void;
  getPrimaryWallet: () => Wallet | undefined;
}

export const useWalletsStore = create<WalletsState>((set, get) => ({
  wallets: [],
  selectedWalletId: null,

  setWallets: (wallets) => {
    const primary = wallets.find((w) => w.isPrimary);
    set({
      wallets,
      selectedWalletId: primary?.id || wallets[0]?.id || null,
    });
  },

  addWallet: (wallet) =>
    set((state) => ({
      wallets: [...state.wallets, wallet],
      selectedWalletId: state.selectedWalletId || wallet.id,
    })),

  updateWallet: (id, updates) =>
    set((state) => ({
      wallets: state.wallets.map((w) =>
        w.id === id ? { ...w, ...updates } : w
      ),
    })),

  removeWallet: (id) =>
    set((state) => ({
      wallets: state.wallets.filter((w) => w.id !== id),
      selectedWalletId:
        state.selectedWalletId === id
          ? state.wallets.find((w) => w.id !== id)?.id || null
          : state.selectedWalletId,
    })),

  selectWallet: (id) => set({ selectedWalletId: id }),

  getPrimaryWallet: () => {
    const state = get();
    return state.wallets.find((w) => w.isPrimary) || state.wallets[0];
  },
}));
