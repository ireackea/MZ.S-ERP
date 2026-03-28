// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Legacy Migration Phase 4 - Stocktaking + Themes + Backup - 2026-02-27
import React, { useEffect, useMemo } from 'react';
import { Palette } from 'lucide-react';
import { useThemeStore, type ThemeKey } from '@/shared/store/theme.store';

const THEME_LOCAL_KEY = 'ff_theme_preference_v1';

type ThemeTokenSet = {
  '--ff-primary': string;
  '--ff-accent': string;
  '--ff-surface': string;
  '--ff-surface-2': string;
  '--ff-text': string;
};

const THEME_LABELS: Record<ThemeKey, string> = {
  classic: 'Classic',
  material: 'Material',
  fiori: 'Fiori',
  fluent: 'Fluent',
};

const THEME_TOKENS: Record<ThemeKey, ThemeTokenSet> = {
  classic: {
    '--ff-primary': '#0f172a',
    '--ff-accent': '#2563eb',
    '--ff-surface': '#f8fafc',
    '--ff-surface-2': '#ffffff',
    '--ff-text': '#0f172a',
  },
  material: {
    '--ff-primary': '#1e293b',
    '--ff-accent': '#7c3aed',
    '--ff-surface': '#f5f3ff',
    '--ff-surface-2': '#ffffff',
    '--ff-text': '#1e1b4b',
  },
  fiori: {
    '--ff-primary': '#0f172a',
    '--ff-accent': '#0ea5e9',
    '--ff-surface': '#ecfeff',
    '--ff-surface-2': '#ffffff',
    '--ff-text': '#083344',
  },
  fluent: {
    '--ff-primary': '#0f172a',
    '--ff-accent': '#14b8a6',
    '--ff-surface': '#f0fdfa',
    '--ff-surface-2': '#ffffff',
    '--ff-text': '#134e4a',
  },
};

type ThemeSwitcherProps = {
  className?: string;
  compact?: boolean;
};

const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ className, compact = false }) => {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  useEffect(() => {
    try {
      const persisted = localStorage.getItem(THEME_LOCAL_KEY) as ThemeKey | null;
      if (persisted && ['classic', 'material', 'fiori', 'fluent'].includes(persisted) && persisted !== theme) {
        setTheme(persisted);
      }
    } catch {
      // Ignore malformed local storage
    }
  }, [setTheme, theme]);

  useEffect(() => {
    const root = document.documentElement;
    const tokens = THEME_TOKENS[theme];
    (Object.keys(tokens) as Array<keyof ThemeTokenSet>).forEach((token) => {
      root.style.setProperty(token, tokens[token]);
    });

    root.classList.remove('classic', 'material', 'fiori', 'fluent');
    root.classList.add(theme);
    root.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_LOCAL_KEY, theme);
  }, [theme]);

  const options = useMemo(
    () =>
      (Object.keys(THEME_LABELS) as ThemeKey[]).map((key) => ({
        key,
        label: THEME_LABELS[key],
      })),
    [],
  );

  return (
    <div className={className}>
      <label
        className={`inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 ${
          compact ? 'w-auto' : 'w-full'
        }`}
      >
        <Palette size={16} />
        {!compact && <span className="font-semibold">Theme</span>}
        <select
          aria-label="Theme switcher"
          value={theme}
          onChange={(event) => setTheme(event.target.value as ThemeKey)}
          className="min-w-[120px] bg-transparent text-sm outline-none"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
};

export default ThemeSwitcher;

