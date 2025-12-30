import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  hasCompletedOnboarding: boolean;
  _hasHydrated: boolean;
  setAuth: (token: string, userId: string) => void;
  clearAuth: () => void;
  completeOnboarding: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      isAuthenticated: false,
      hasCompletedOnboarding: false,
      _hasHydrated: false,

      setAuth: (token, userId) =>
        set({
          token,
          userId,
          isAuthenticated: true,
        }),

      clearAuth: () =>
        set({
          token: null,
          userId: null,
          isAuthenticated: false,
        }),

      completeOnboarding: () =>
        set({
          hasCompletedOnboarding: true,
        }),

      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'migratorrr-auth',
      partialize: (state) => ({
        token: state.token,
        userId: state.userId,
        isAuthenticated: state.isAuthenticated,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
