import fs from 'node:fs';
import path from 'node:path';

export { APP_DIR_NAME, dataDir } from '@shared/datadir';
import { dataDir } from '@shared/datadir';

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function logsDir(): string {
  return ensureDir(path.join(dataDir(), 'logs'));
}

export function daemonJsonPath(): string {
  return path.join(dataDir(), 'daemon.json');
}

export function dbPath(): string {
  return path.join(dataDir(), 'asm.db');
}

/** Images attached to orders and messages: sessions get them as file paths (Claude can read this folder). */
export function attachmentsDir(): string {
  return ensureDir(path.join(dataDir(), 'attachments'));
}

export function daemonLogPath(): string {
  return path.join(dataDir(), 'daemon.log');
}

/** Session holders (holder.ts): their info / exit files; on non-Windows also their sockets. */
export function holdersDir(): string {
  return ensureDir(path.join(dataDir(), 'holders'));
}

/** The daemon's single-instance lock: a pipe only one daemon of this data folder can listen on (freed when it dies). */
export function daemonLockPipe(): string {
  const tag = dataDir().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(-60);
  return process.platform === 'win32' ? `\\\\.\\pipe\\agento-daemon-${tag}` : path.join(dataDir(), 'daemon.lock.sock');
}

/** The local pipe a session holder listens on. */
export function holderPipe(id: string, nonce: string): string {
  return process.platform === 'win32' ? `\\\\.\\pipe\\agento-${id}-${nonce}` : path.join(holdersDir(), `${id}-${nonce}.sock`);
}
