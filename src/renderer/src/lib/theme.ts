import type { ITheme } from '@xterm/xterm';

/**
 * Theme as in the shared theme spec (docs/xo-common-spec.md ch. 3, 2026-10-29): light · dark · system,
 * default system. Applied as `<html data-theme>` plus ReadO's `body.theme-light|theme-dark`.
 * The main process keeps the choice on disk (src/main/theme.ts) and tells the other windows; localStorage
 * xo.theme is a copy (and where the choice came from before). public/theme-init.js applies the same before
 * the first paint — keep the two in step.
 */
export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'xo.theme';
/** before 2026-10-29; read once when xo.theme is missing, left in place */
const OLD_KEY = 'asm.theme';
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

function isPref(v: unknown): v is ThemePref {
  return v === 'light' || v === 'dark' || v === 'system';
}

function initialPref(): ThemePref {
  const kept = window.desktop?.getTheme?.();
  if (isPref(kept)) return kept;
  try {
    const v = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (isPref(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

let pref: ThemePref = initialPref();

export function getThemePref(): ThemePref {
  return pref;
}

export function resolvedTheme(): ResolvedTheme {
  const pref = getThemePref();
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref;
}

function apply(): void {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.body?.classList.remove(t === 'dark' ? 'theme-light' : 'theme-dark');
  document.body?.classList.add(`theme-${t}`);
  for (const fn of listeners) fn(t);
}

export function setThemePref(p: ThemePref): void {
  pref = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* storage unavailable */
  }
  window.desktop?.setTheme?.(p);
  apply();
}

export function onThemeChange(fn: (t: ResolvedTheme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Another window (main ↔ panels ↔ file windows) changed the theme.
window.desktop?.onThemeChanged?.((p) => {
  pref = p;
  apply();
});
media.addEventListener('change', () => {
  if (pref === 'system') apply();
});
// first start after the update: hand the localStorage choice to the main process
if (window.desktop?.getTheme && window.desktop.getTheme() === null) window.desktop.setTheme(pref);
apply();
