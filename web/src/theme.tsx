// ThemeProvider — CONTRACT §8 (v3). Holds the active theme, mirrors it onto
// <html> as data-theme/-density/-nav, persists to localStorage.lodestar-theme.
// The pre-paint work is done by the inline script in index.html; this provider
// keeps runtime switches in sync (and fixes up anything the script missed).

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { resolveTheme, THEMES, type ThemeDef, type ThemeId } from './themes';

const STORAGE_KEY = 'lodestar-theme';

interface ThemeState {
  theme: ThemeDef;
  themes: ThemeDef[];
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function applyToDocument(theme: ThemeDef): void {
  const el = document.documentElement;
  el.dataset.theme = theme.id;
  el.dataset.density = theme.density;
  el.dataset.nav = theme.nav;
  // keep the browser chrome / PWA bar on the page colour
  const paper = getComputedStyle(el).getPropertyValue('--paper').trim();
  if (paper) {
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute('content', paper));
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeDef] = useState<ThemeDef>(() =>
    resolveTheme(localStorage.getItem(STORAGE_KEY)),
  );

  useEffect(() => {
    applyToDocument(theme);
    localStorage.setItem(STORAGE_KEY, theme.id);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeDef(resolveTheme(id));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themes: THEMES, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
