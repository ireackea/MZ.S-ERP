import { useThemeStore } from '../store/theme.store';

export const useTheme = () => {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const autoSync = useThemeStore((s) => s.autoSync);
  const setAutoSync = useThemeStore((s) => s.setAutoSync);
  return { theme, setTheme, autoSync, setAutoSync };
};

export default useTheme;
