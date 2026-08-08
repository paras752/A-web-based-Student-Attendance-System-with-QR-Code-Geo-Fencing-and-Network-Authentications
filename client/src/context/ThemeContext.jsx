import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'ssas-theme';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // Private-mode browsers can throw on localStorage access; fall back to the OS.
    return 'system';
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readStoredPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Keep following the OS while the preference is "system", so the app flips
  // when the user changes their OS theme without needing a reload.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    // Bootstrap 5.3 reads its own attribute; keep them in step so any remaining
    // Bootstrap-styled element doesn't sit on the wrong background.
    root.setAttribute('data-bs-theme', resolved);
  }, [resolved]);

  const setTheme = useCallback((next) => {
    setPreference(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* preference simply won't persist */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  const value = useMemo(
    () => ({ theme: resolved, preference, setTheme, toggle, isDark: resolved === 'dark' }),
    [resolved, preference, setTheme, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
