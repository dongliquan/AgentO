import type { ITheme } from '@xterm/xterm';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'asm.theme';
const listeners = new Set<(t: ResolvedTheme) => void>();
const media = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * CLI TUIs (Claude Code etc.) are designed for dark terminals, so terminals stay dark in every app theme.
 * Palette: One Dark (as ReadO's dark theme) — softer reds and greens than VS Code's.
 */
export const TERMINAL_THEME: ITheme = {
  background: '#21252b',
  foreground: '#abb2bf',
  cursor: '#abb2bf',
  cursorAccent: '#21252b',
  selectionBackground: 'rgba(97,175,239,0.3)',
  black: '#282c34',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff'
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
