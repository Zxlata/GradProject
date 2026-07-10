import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
// theme    : 'light' | 'dark' | 'system'   (user's stored preference)
// resolved : 'light' | 'dark'              (what the page actually renders)

const STORAGE_KEY = 'ai-interview-theme';

const ThemeContext = createContext(null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return the OS preference: 'dark' | 'light' */
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** Persist resolved theme to DOM so Bootstrap 5.3 + custom CSS pick it up. */
function applyToDom(resolved) {
  const root = document.documentElement;
  // Bootstrap 5.3 native dark mode
  root.setAttribute('data-bs-theme', resolved);
  // Our own CSS custom-property hook
  root.setAttribute('data-theme', resolved);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }) {
  const [theme, setThemeRaw] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'system'
  );

  const resolve = useCallback(
    (pref) => (pref === 'system' ? getSystemTheme() : pref),
    []
  );

  const [resolvedTheme, setResolvedTheme] = useState(() =>
    resolve(localStorage.getItem(STORAGE_KEY) || 'system')
  );

  // Apply whenever the stored preference changes
  useEffect(() => {
    const resolved = resolve(theme);
    setResolvedTheme(resolved);
    applyToDom(resolved);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, resolve]);

  // Track OS preference changes when mode === 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      const resolved = e.matches ? 'dark' : 'light';
      setResolvedTheme(resolved);
      applyToDom(resolved);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (['light', 'dark', 'system'].includes(next)) setThemeRaw(next);
  }, []);

  const value = {
    /** User's stored preference: 'light' | 'dark' | 'system' */
    theme,
    /** What is actually rendered: 'light' | 'dark' */
    resolvedTheme,
    /** Shorthand — true when the page is currently dark */
    isDark: resolvedTheme === 'dark',
    setTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

export default ThemeContext;
