'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SniperConfig } from './snipers';

// Only public key is stored - private key is NEVER persisted
export interface GeneratedWalletPublic {
  publicKey: string;
}

export interface ConnectedWalletPublic {
  publicKey: string;
}

export interface PendingSniperConfig {
  name: string;
  config: SniperConfig;
  createdAt: number; // timestamp to expire old configs
  generatedWallet?: GeneratedWalletPublic; // Only public key - private key is NEVER stored
  connectedWallet?: ConnectedWalletPublic; // Wallet connected via wallet adapter (e.g., Phantom)
}

interface PendingSniperStore {
  pendingSniper: PendingSniperConfig | null;
  setPendingSniper: (config: PendingSniperConfig) => void;
  clearPendingSniper: () => void;
  hasPendingSniper: () => boolean;
}

export const usePendingSniperStore = create<PendingSniperStore>()(
  persist(
    (set, get) => ({
      pendingSniper: null,

      setPendingSniper: (config) => {
        // SECURITY: Ensure private key is never in the persisted config
        // Only store public key from generated or connected wallet
        const safeConfig: PendingSniperConfig = {
          ...config,
          generatedWallet: config.generatedWallet
            ? { publicKey: config.generatedWallet.publicKey }
            : undefined,
          connectedWallet: config.connectedWallet
            ? { publicKey: config.connectedWallet.publicKey }
            : undefined,
        };
        set({ pendingSniper: safeConfig });
      },

      clearPendingSniper: () => {
        set({ pendingSniper: null });
      },

      hasPendingSniper: () => {
        const { pendingSniper } = get();
        if (!pendingSniper) return false;

        // Expire configs older than 24 hours
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        if (pendingSniper.createdAt < oneDayAgo) {
          set({ pendingSniper: null });
          return false;
        }

        return true;
      },
    }),
    {
      name: 'migratorrr-pending-sniper',
    }
  )
);
