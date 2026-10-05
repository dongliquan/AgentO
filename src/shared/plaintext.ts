/**
 * Terminal output → plain text lines, without a terminal emulator.
 *
 * TUIs (Claude Code with Ink, Codex) do not print spaces or line feeds for layout: they move the cursor —
 * CSI n C / n G / n D within a row, \r, CSI n A / n B, CSI row;col H between rows — and overwrite. Dropping every
 * escape sequence, what a plain "strip ANSI" does, glues words and rows together ("Yes,Itrustthisfolder",
 * "❯1.Setitup"), so prompt detection and option parsing fail. This keeps a small character grid with a cursor and
 * resolves the moves into spacing and rows. No scrolling region, no wrapping, no colors: good enough to read prompts
 * and previews. The renderer replays the real screen with xterm when it needs the exact layout.
 * Pure TypeScript, no deps — shared by the daemon and the renderer.
 */

const ESC = '\x1b';
/** rows kept at most (long plain streams just grow row by row; the oldest rows are dropped) */
const ROW_CAP = 4000;

class Grid {
  rows: string[][] = [];
  row = 0;
  col = 0;
  private saved: [number, number] | null = null;

  private line(): string[] {
    while (this.rows.length <= this.row) this.rows.push([]);
    if (this.rows.length > ROW_CAP) {
      const drop = this.rows.length - ROW_CAP / 2;
      this.rows.splice(0, drop);
      this.row = Math.max(0, this.row - drop);
    }
    return this.rows[this.row]!;
  }

  put(ch: string): void {
    const l = this.line();
    while (l.length < this.col) l.push(' ');
    l[this.col] = ch;
    this.col++;
  }

  clear(): void {
    this.rows = [];
    this.row = 0;
    this.col = 0;
  }

  save(): void {
    this.saved = [this.row, this.col];
  }

  restore(): void {
    if (this.saved) [this.row, this.col] = this.saved;
  }

  /** CSI sequence: params already split, `final` the command letter. */
  csi(params: string, final: string): void {
    const priv = params.startsWith('?');
    const p = (priv ? params.slice(1) : params).split(';').map((x) => parseInt(x, 10));
    const a = Number.isFinite(p[0]!) && p[0]! > 0 ? p[0]! : 1;
    if (priv) {
      // alternate screen on/off: a fresh screen either way
      if ((final === 'h' || final === 'l') && (p.includes(1049) || p.includes(47) || p.includes(1047))) this.clear();
      return;
    }
    switch (final) {
      case 'A':
        this.row = Math.max(0, this.row - a);
        break;
      case 'B':
      case 'e':
        this.row += a;
        break;
      case 'C':
      case 'a':
        this.col += a;
        break;
      case 'D':
        this.col = Math.max(0, this.col - a);
        break;
      case 'E':
        this.row += a;
        this.col = 0;
        break;
      case 'F':
        this.row = Math.max(0, this.row - a);
        this.col = 0;
        break;
      case 'G':
      case '`':
        this.col = a - 1;
        break;
      case 'd':
        this.row = a - 1;
        break;
      case 'H':
      case 'f': {
        const c = Number.isFinite(p[1]!) && p[1]! > 0 ? p[1]! : 1;
        this.row = a - 1;
        this.col = c - 1;
        break;
      }
      case 'J': {
        const mode = Number.isFinite(p[0]!) ? p[0]! : 0;
        if (mode === 2 || mode === 3) {
          const r = this.row;
          const c = this.col;
          this.clear();
          this.row = r;
          this.col = c;
        } else if (mode === 0) {
          this.line().length = Math.min(this.line().length, this.col);
          this.rows.length = this.row + 1;
        } else {
          for (let i = 0; i < this.row; i++) this.rows[i] = [];
          const l = this.line();
          for (let i = 0; i <= this.col && i < l.length; i++) l[i] = ' ';
        }
        break;
      }
      case 'K': {
        const mode = Number.isFinite(p[0]!) ? p[0]! : 0;
        const l = this.line();
        if (mode === 0) l.length = Math.min(l.length, this.col);
        else if (mode === 2) l.length = 0;
        else for (let i = 0; i <= this.col && i < l.length; i++) l[i] = ' ';
        break;
      }
      case 'X': {
        const l = this.line();
        for (let k = 0; k < a && this.col + k < l.length; k++) l[this.col + k] = ' ';
        break;
      }
      case 'P': {
        this.line().splice(this.col, a);
        break;
      }
      case '@': {
        const l = this.line();
        while (l.length < this.col) l.push(' ');
        l.splice(this.col, 0, ...new Array<string>(a).fill(' '));
        break;
      }
      case 's':
        this.save();
        break;
      case 'u':
        this.restore();
        break;
      default:
        break; // colors, modes, scroll regions, reports: ignored
    }
  }
}

/** Raw terminal output → plain text lines (cursor moves resolved to spacing and rows, colors dropped). */
export function plainTerminalLines(raw: string): string[] {
  const g = new Grid();
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i]!;
    if (c === ESC) {
      const nx = raw[i + 1];
      if (nx === '[') {
        let j = i + 2;
        while (j < n && /[0-?]/.test(raw[j]!)) j++;
        while (j < n && /[ -\/]/.test(raw[j]!)) j++;
        if (j < n) g.csi(raw.slice(i + 2, j).replace(/[ -\/]+$/, ''), raw[j]!);
        i = j + 1;
        continue;
      }
      if (nx === ']' || nx === 'P' || nx === '^' || nx === '_') {
        // OSC / DCS / PM / APC: until BEL or ST
        let j = i + 2;
        while (j < n && raw[j] !== '\x07' && !(raw[j] === ESC && raw[j + 1] === '\\')) j++;
        i = raw[j] === ESC ? j + 2 : j + 1;
        continue;
      }
      if (nx === '(' || nx === ')' || nx === '#' || nx === '%') {
        i += 3; // charset designation
        continue;
      }
      if (nx === '7') g.save();
      else if (nx === '8') g.restore();
      else if (nx === 'D') g.row++;
      else if (nx === 'E') {
        g.row++;
        g.col = 0;
      } else if (nx === 'M') g.row = Math.max(0, g.row - 1);
      else if (nx === 'c') g.clear();
      i += 2;
      continue;
    }
    if (c === '\n') {
      g.row++;
      i++;
      continue;
    }
    if (c === '\r') {
      g.col = 0;
      i++;
      continue;
    }
    if (c === '\t') {
      g.col = (Math.floor(g.col / 8) + 1) * 8;
      i++;
      continue;
    }
    if (c === '\x08') {
      g.col = Math.max(0, g.col - 1);
      i++;
      continue;
    }
    const code = c.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      i++;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < n) {
      // surrogate pair in one cell
      g.put(c + raw[i + 1]!);
      i += 2;
      continue;
    }
    g.put(c);
    i++;
  }
  const out = g.rows.map((l) => l.join('').replace(/\s+$/, ''));
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** Raw terminal output → plain text (lines joined with \n). */
export function plainTerminalText(raw: string): string {
  return plainTerminalLines(raw).join('\n');
}
