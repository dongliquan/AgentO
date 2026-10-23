export const isMac = window.desktop?.platform === 'darwin';

/** Shortcut text for labels/tooltips: "Ctrl+Shift+P" → "⌘+Shift+P" on macOS (Alt → ⌥). Not for the terminal's own Ctrl+C. */
export function kbd(shortcut: string): string {
  if (!isMac) return shortcut;
  return shortcut.replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥');
}

/** Returns true when the keyboard event should be handled by the app even if a terminal has focus. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === 'F2' || e.key === 'F11' || e.key === 'Escape') return true;
  if (!ctrl) return false;
  if (e.shiftKey && (k === 'p' || k === 'w')) return true;
  if (!e.shiftKey && (k === 'p' || k === 'b' || k === 'n')) return true;
  if (k === '1' || k === '2' || k === '3' || k === '4') return true;
  if (k === '=' || k === '+' || k === '-' || k === '_' || k === '0') return true;
  return false;
}
