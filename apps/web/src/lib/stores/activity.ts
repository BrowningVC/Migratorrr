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
          // Check for duplicate by matching eventType + timestamp (within 1 second)
          const isDuplicate = state.entries.some(
            (e) =>
              e.eventType === entry.eventType &&
              Math.abs(new Date(e.timestamp).getTime() - new Date(entry.timestamp).getTime()) < 1000
          );
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
          const existingTimestamps = new Set(
            state.entries.map((e) => `${e.eventType}-${e.timestamp}`)
          );

          const newEntries = apiEntries.filter((e) => {
            if (existingIds.has(e.id)) return false;
            if (existingTimestamps.has(`${e.eventType}-${e.timestamp}`)) return false;
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
        state?.setHasHydrated(true);
      },
    }
  )
);
