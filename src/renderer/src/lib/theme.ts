import type { ITheme } from '@xterm/xterm';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'asm.theme';
const listeners = new Set<(t: ResolvedTheme) => void>();
const media = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * CLI TUIs (Claude Code etc.) are designed for dark terminals, so terminals stay dark in every app theme.
 * Palette: VS Code "Dark Modern" integrated terminal.
 */
export const TERMINAL_THEME: ITheme = {
  background: '#1f1f1f',
  foreground: '#cccccc',
  cursor: '#cccccc',
  cursorAccent: '#1f1f1f',
  selectionBackground: 'rgba(38,79,120,0.8)',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
};

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'light';
}

export function resolvedTheme(): ResolvedTheme {
  const pref = getThemePref();
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref;
}

function apply(): void {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  for (const fn of listeners) fn(t);
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable */
  }
  apply();
}

export function onThemeChange(fn: (t: ResolvedTheme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Another window (main ↔ panels) changed the theme.
window.addEventListener('storage', (e) => {
  if (e.key === KEY) apply();
});
media.addEventListener('change', () => {
  if (getThemePref() === 'system') apply();
});
apply();
