/**
 * The theme choice (shared theme spec ch. 3). The main process keeps it in ui-theme.json, written at once — the
 * renderers' localStorage is flushed lazily and lost when the UI is killed. Windows read it synchronously at
 * start (preload getTheme) so new windows open in the right colors; View › Theme shows it as a radio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { nativeTheme } from 'electron';
import { dataDir } from '@shared/datadir';

export type ThemePref = 'light' | 'dark' | 'system';

const file = (): string => path.join(dataDir(), 'ui-theme.json');

/** null until a window has told us (first start after an update: the renderer moves its localStorage value here) */
function read(): ThemePref | null {
  try {
    const v = (JSON.parse(fs.readFileSync(file(), 'utf8')) as { pref?: unknown }).pref;
    if (v === 'light' || v === 'dark' || v === 'system') return v;
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
  return pref ?? 'system';
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

/** --bg / --panel / --text of the resolved theme (styles.css) */
export function windowColors(): { bg: string; panel: string; text: string } {
  const p = themePref();
  const dark = p === 'dark' || (p === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? { bg: '#21252b', panel: '#282c34', text: '#abb2bf' } : { bg: '#f6f7f9', panel: '#ffffff', text: '#1f2328' };
}
