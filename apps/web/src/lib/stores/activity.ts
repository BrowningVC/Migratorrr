import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ActivityEntry {
  id: string;
  eventType: string;
  eventData: Record<string, unknown>;
  timestamp: string;
}

interface ActivityState {
  entries: ActivityEntry[];
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  addEntry: (entry: Omit<ActivityEntry, 'id'>) => void;
  clearEntries: () => void;
  setEntries: (entries: ActivityEntry[]) => void;
  mergeEntries: (entries: ActivityEntry[]) => void;
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      entries: [],
      _hasHydrated: false,

      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },

      addEntry: (entry) =>
        set((state) => {
          const newEntry = {
            ...entry,
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          };
          // Check for duplicate by matching eventType + tokenMint + timestamp (within 1 second)
          // Include tokenMint or signature to allow different trades at same time
          const entryTokenMint = (entry.eventData?.tokenMint as string) || '';
          const entrySignature = (entry.eventData?.signature as string) || '';

          const isDuplicate = state.entries.some((e) => {
            if (e.eventType !== entry.eventType) return false;

            const existingTokenMint = (e.eventData?.tokenMint as string) || '';
            const existingSignature = (e.eventData?.signature as string) || '';

            // If we have signatures, use those for exact match
            if (entrySignature && existingSignature) {
              return entrySignature === existingSignature;
            }

            // Otherwise check tokenMint + timestamp
            const sameToken = entryTokenMint === existingTokenMint;
            const timeDiff = Math.abs(new Date(e.timestamp).getTime() - new Date(entry.timestamp).getTime());
            return sameToken && timeDiff < 1000;
          });

          if (isDuplicate) return state;

          return {
            entries: [newEntry, ...state.entries].slice(0, 100),
          };
        }),

      clearEntries: () => set({ entries: [] }),

      setEntries: (entries) => set({ entries: entries.slice(0, 100) }),

      // Merge API entries with existing, avoiding duplicates
      mergeEntries: (apiEntries) =>
        set((state) => {
          const existingIds = new Set(state.entries.map((e) => e.id));

          // Create a unique key for each existing entry using signature or eventType+tokenMint+timestamp
          const existingKeys = new Set(
            state.entries.map((e) => {
              const sig = (e.eventData?.signature as string) || '';
              if (sig) return `sig:${sig}`;
              const tokenMint = (e.eventData?.tokenMint as string) || '';
              return `${e.eventType}-${tokenMint}-${e.timestamp}`;
            })
          );

          const newEntries = apiEntries.filter((e) => {
            if (existingIds.has(e.id)) return false;

            // Check by unique key
            const sig = (e.eventData?.signature as string) || '';
            const key = sig ? `sig:${sig}` : `${e.eventType}-${(e.eventData?.tokenMint as string) || ''}-${e.timestamp}`;
            if (existingKeys.has(key)) return false;

            return true;
          });

          // Combine and sort by timestamp (newest first)
          const combined = [...state.entries, ...newEntries]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 100);

          return { entries: combined };
        }),
    }),
    {
      name: 'migratorrr-activity',
      onRehydrateStorage: () => (state) => {
        // One-time cleanup: Remove price:update entries that shouldn't be stored
        if (state && state.entries.length > 0) {
          const cleanedEntries = state.entries.filter(
            (e) => e.eventType !== 'price:update'
          );
          if (cleanedEntries.length !== state.entries.length) {
            console.log(`[ActivityStore] Cleaned ${state.entries.length - cleanedEntries.length} stale price:update entries`);
            state.setEntries(cleanedEntries);
          }
        }
        state?.setHasHydrated(true);
      },
    }
  )
);
