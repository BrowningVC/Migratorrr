import { create } from 'zustand';

export interface ActivityEntry {
  id: string;
  eventType: string;
  eventData: Record<string, unknown>;
  timestamp: string;
}

interface ActivityState {
  entries: ActivityEntry[];
  addEntry: (entry: Omit<ActivityEntry, 'id'>) => void;
  clearEntries: () => void;
  setEntries: (entries: ActivityEntry[]) => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  entries: [],

  addEntry: (entry) =>
    set((state) => ({
      entries: [
        { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
        ...state.entries,
      ].slice(0, 100), // Keep last 100 entries
    })),

  clearEntries: () => set({ entries: [] }),

  setEntries: (entries) => set({ entries }),
}));
