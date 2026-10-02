import fs from 'node:fs';
import { daemonLogPath, ensureDir, dataDir } from './paths';

let stream: fs.WriteStream | null = null;

function getStream(): fs.WriteStream {
  if (!stream) {
    ensureDir(dataDir());
    stream = fs.createWriteStream(daemonLogPath(), { flags: 'a' });
    stream.on('error', () => {
      /* never crash on log failures */
    });
  }
  return stream;
}

function fmt(level: string, args: unknown[]): string {
  const text = args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  return `${new Date().toISOString()} [${level}] ${text}\n`;
}

export const log = {
  info(...args: unknown[]): void {
    const line = fmt('INFO', args);
    getStream().write(line);
    if (process.env['ASM_VERBOSE']) process.stdout.write(line);
  },
  warn(...args: unknown[]): void {
    const line = fmt('WARN', args);
    getStream().write(line);
    if (process.env['ASM_VERBOSE']) process.stderr.write(line);
  },
  error(...args: unknown[]): void {
    const line = fmt('ERROR', args);
    getStream().write(line);
    process.stderr.write(line);
  },
  close(): void {
    stream?.end();
    stream = null;
  }
};
