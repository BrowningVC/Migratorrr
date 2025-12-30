'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SniperConfig } from './snipers';

export interface PendingSniperConfig {
  name: string;
  config: SniperConfig;
  namePatterns?: string;
  excludedPatterns?: string;
  createdAt: number; // timestamp to expire old configs
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
        set({ pendingSniper: config });
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
