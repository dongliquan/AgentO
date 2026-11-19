/**
 * The holders' own runtime. A holder (holder.ts) is the long-lived process that owns one session's CLI. It used to run
 * from the build folder that started it, so that folder could not be replaced or deleted while the session lived, and
 * every deploy left another ~400 MB folder behind. Now a holder runs from a copy in the data folder
 * (`runtime/<key>`: Electron as Node, the holder script and node-pty) — the build folders are free the moment the
 * daemon and the window are replaced.
 *
 * The key is a hash of everything the holder runs from (Electron version, holder and chunk files, node-pty), so a new
 * copy is made only when the holder itself changes, and a running holder is never touched. Old copies are removed when
 * no holder runs from them any more. Anything that goes wrong falls back to the build folder (the old behaviour).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { log } from './log';
import { dataDir, ensureDir } from './paths';

export interface HolderRuntime {
  /** the executable that runs the holder (Electron as Node) */
  exe: string;
  /** the holder script */
  script: string;
  /** the runtime folder, or '' when the build folder itself is used */
  dir: string;
}

const runtimeRoot = (): string => ensureDir(path.join(dataDir(), 'runtime'));

/** the daemon's `out` folder (…/app.asar/out in a packaged build) */
const outDir = (): string => path.resolve(__dirname, '..');
const packaged = (): boolean => /app\.asar/i.test(outDir());

function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)).map((f) => path.join(e.name, f)) : [e.name]));
  } catch {
    return [];
  }
}

function copyTree(from: string, to: string, files: string[]): void {
  for (const f of files) {
    const dest = path.join(to, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(from, f), dest);
  }
}

let cached: HolderRuntime | null = null;

/** The runtime a new holder starts from (made on first use, then reused). */
export function holderRuntime(fallbackScript: string): HolderRuntime {
  if (cached && fs.existsSync(cached.exe)) return cached;
  const fallback: HolderRuntime = { exe: process.execPath, script: fallbackScript, dir: '' };
  if (!packaged() || process.env['AGENTO_HOLDER_RUNTIME'] === '0') return fallback;
  try {
    const out = outDir();
    const electronDir = path.dirname(process.execPath);
    const ptySrc = path.join(electronDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
    const holderFiles = [...listFiles(path.join(out, 'holder')).map((f) => path.join('holder', f)), ...listFiles(path.join(out, 'chunks')).map((f) => path.join('chunks', f))];
    const ptyFiles = ['package.json', ...['lib', 'build', 'prebuilds'].flatMap((d) => listFiles(path.join(ptySrc, d)).map((f) => path.join(d, f)))].filter((f) => !/\.(pdb|obj|lib|exp|ilk)$/i.test(f));
    const hash = createHash('sha256').update(process.versions.electron ?? '');
    for (const f of holderFiles) hash.update(f).update(fs.readFileSync(path.join(out, f)));
    for (const f of ['package.json', ...ptyFiles.filter((p) => /\.node$/i.test(p))]) hash.update(f).update(fs.readFileSync(path.join(ptySrc, f)));
    const key = hash.digest('hex').slice(0, 12);
    const dir = path.join(runtimeRoot(), key);
    const exe = path.join(dir, path.basename(process.execPath));
    if (!fs.existsSync(path.join(dir, 'ready'))) {
      const tmp = `${dir}.tmp-${process.pid}`;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      // Electron itself: the executable and the libraries / data files beside it (no app, no locales)
      for (const e of fs.readdirSync(electronDir, { withFileTypes: true })) if (e.isFile()) fs.copyFileSync(path.join(electronDir, e.name), path.join(tmp, e.name));
      copyTree(out, path.join(tmp, 'out'), holderFiles);
      copyTree(ptySrc, path.join(tmp, 'out', 'node_modules', 'node-pty'), ptyFiles);
      fs.writeFileSync(path.join(tmp, 'ready'), JSON.stringify({ key, electron: process.versions.electron, at: Date.now() }));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      log.info('holder runtime: made', key);
    }
    cached = { exe, script: path.join(dir, 'out', 'holder', 'index.js'), dir };
    return cached;
  } catch (e) {
    log.warn('holder runtime: not available, holders run from the build folder', e);
    return fallback;
  }
}

/** Remove runtime copies no holder runs from (a live holder records its executable in its info file). */
export function pruneRuntimes(inUse: Iterable<string | undefined>): void {
  try {
    const keep = new Set<string>();
    for (const exe of inUse) if (exe) keep.add(path.resolve(path.dirname(exe)).toLowerCase());
    if (cached?.dir) keep.add(path.resolve(cached.dir).toLowerCase());
    for (const name of fs.readdirSync(runtimeRoot())) {
      const dir = path.join(runtimeRoot(), name);
      if (keep.has(path.resolve(dir).toLowerCase())) continue;
      // a copy made a moment ago may belong to a holder that has not written its info file yet
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs < 10 * 60_000) continue;
      } catch {
        continue;
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        log.info('holder runtime: removed', name);
      } catch {
        /* still in use: kept */
      }
    }
  } catch {
    /* none */
  }
}
