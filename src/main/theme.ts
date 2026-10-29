/**
 * The theme choice (shared theme spec ch. 3: light or dark, default light). The main process keeps it in
 * ui-theme.json, written at once — the renderers' localStorage is flushed lazily and lost when the UI is
 * killed. Windows read it synchronously at start (preload getTheme) so new windows open in the right colors;
 * View › Theme shows it as a radio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '@shared/datadir';

export type ThemePref = 'light' | 'dark';

const file = (): string => path.join(dataDir(), 'ui-theme.json');

/** null until a window has told us (first start after an update; an old "system" is resolved by the renderer) */
function read(): ThemePref | null {
  try {
    const v = (JSON.parse(fs.readFileSync(file(), 'utf8')) as { pref?: unknown }).pref;
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* first run */
  }
  return null;
}

let pref: ThemePref | null = read();

export function storedThemePref(): ThemePref | null {
  return pref;
}

export function themePref(): ThemePref {
  return pref ?? 'light';
}

/** Returns true when the choice changed. */
export function setThemePref(p: ThemePref): boolean {
  if (p === pref) return false;
  pref = p;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ pref: p }));
  } catch {
    /* kept for this run only */
  }
  return true;
}

/** --bg / --panel / --text of the theme (styles.css) */
export function windowColors(): { bg: string; panel: string; text: string } {
  return themePref() === 'dark'
    ? { bg: '#21252b', panel: '#282c34', text: '#abb2bf' }
    : { bg: '#f6f7f9', panel: '#ffffff', text: '#1f2328' };
}
