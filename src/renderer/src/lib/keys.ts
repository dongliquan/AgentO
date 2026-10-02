/** Returns true when the keyboard event should be handled by the app even if a terminal has focus. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === 'F2' || e.key === 'F11' || e.key === 'Escape') return true;
  if (!ctrl) return false;
  if (e.shiftKey && (k === 'p' || k === 'w')) return true;
  if (!e.shiftKey && (k === 'p' || k === 'b' || k === 'n')) return true;
  if (k === '1' || k === '2' || k === '3') return true;
  if (k === '=' || k === '+' || k === '-' || k === '_' || k === '0') return true;
  return false;
}

