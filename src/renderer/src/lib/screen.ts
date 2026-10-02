import { Terminal } from '@xterm/xterm';

/**
 * The lines a terminal shows now, rebuilt from its raw output: TUIs (Claude Code, Codex) draw with cursor moves, so
 * the raw text runs words and lines together — an off-screen xterm of the session's size replays the tail and is read
 * row by row. No DOM: the terminal is never opened, only fed and read.
 */
export function screenLines(data: string, cols: number, rows: number): Promise<string[]> {
  return new Promise((resolve) => {
    let term: Terminal;
    try {
      term = new Terminal({ cols: Math.max(20, cols), rows: Math.max(5, rows), scrollback: 0, allowProposedApi: true });
    } catch {
      resolve([]);
      return;
    }
    term.write(data, () => {
      const b = term.buffer.active;
      const out: string[] = [];
      for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
      term.dispose();
      resolve(out);
    });
  });
}
