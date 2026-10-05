import { plainTerminalText } from '@shared/plaintext';

/**
 * Terminal output → plain text. Cursor moves (CSI n C / n G, \r) become spacing instead of being dropped: Claude Code's
 * TUI positions every word with them on macOS/Linux, so a plain strip glues the words together.
 */
export function stripAnsi(s: string): string {
  return plainTerminalText(s);
}

/** Last `n` non-empty plain-text lines of a terminal buffer. */
export function lastLines(buffer: string, n: number): string[] {
  if (!buffer) return [];
  // Only look at the tail for performance.
  const tail = buffer.length > 8000 ? buffer.slice(-8000) : buffer;
  const lines = stripAnsi(tail)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
  return lines.slice(-n);
}
