import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useThemeStore, ThemeKey } from '../store/theme.store';
import * as themeApi from '../api/theme.api';

const ThemeContext = createContext({
  ready: false,
});

export const ThemeProvider: React.FC<{ children: ReactNode; userId?: string }> = ({ children, userId }) => {
  const { theme, setTheme, autoSync } = useThemeStore();
  const [ready, setReady] = useState(false);

  // load persisted server theme once (if autosync)
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const serverTheme = await themeApi.getUserTheme(userId);
        if (mounted && serverTheme && typeof serverTheme === 'string' && ['classic','fiori','material','fluent'].includes(serverTheme)) {
          setTheme(serverTheme as ThemeKey);
        }
      } catch (err) {
        // ignore
      } finally {
        if (mounted) setReady(true);
      }
    };
    void init();
    return () => { mounted = false; };
  }, [setTheme, userId]);

  // Apply theme: set document class and lazy-load theme CSS
  useEffect(() => {
      // Immediately set class so CSS rules targetable
    try {
      document.documentElement.className = theme;
      // eslint-disable-next-line no-console
      console.debug('[ThemeProvider] applied theme ->', theme);
    } catch (e) { /* ignore */ }

    // dynamic import of theme CSS (lazy)
    import(`../../themes/${theme}/index.css`).then(() => {
      // eslint-disable-next-line no-console
      console.debug('[ThemeProvider] theme CSS loaded ->', theme);
    }).catch(() => {
      // fallback to classic if something fails
      if (theme !== 'classic') {
        setTheme('classic');
      }
    });

    // persist to localStorage (already handled by zustand persist) and optionally sync
    if (autoSync) {
      void themeApi.updateUserTheme(theme, userId).catch(() => {});
    }
  }, [theme, autoSync, setTheme, userId]);

  return <ThemeContext.Provider value={{ ready }}>{children}</ThemeContext.Provider>;
};

export const useThemeContext = () => useContext(ThemeContext);
