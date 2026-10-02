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
