const CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const OSC = /\x1b\][^\x07]*\x07/g;
const OTHER = /\x1b[()][A-Za-z0-9]|\x1b[=>]|\x1b[78]|\x1b[DEHM]/g;

/** Strip ANSI CSI/OSC escape sequences and control characters (except \n and \t). */
export function stripAnsi(s: string): string {
  return s
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(OTHER, '')
    .replace(/\r/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
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
