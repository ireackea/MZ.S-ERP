import create from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeKey = 'classic' | 'fiori' | 'material' | 'fluent';

interface ThemeState {
  theme: ThemeKey;
  autoSync: boolean;
  setTheme: (t: ThemeKey) => void;
  setAutoSync: (v: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'classic',
      autoSync: true,
      setTheme: (theme: ThemeKey) => {
        // debug: trace theme changes
        // (will appear in browser console when user interacts)
        // eslint-disable-next-line no-console
        console.debug('[theme.store] setTheme', theme);
        set({ theme });
      },
      setAutoSync: (v: boolean) => set({ autoSync: v }),
    }),
    { name: 'ff_theme_store' },
  ),
);
