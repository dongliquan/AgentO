#!/usr/bin/env node
/**
 * 2.0 data migration smoke test — a 1.x data folder (a project with two parts, a part folder on the project's own
 * path, a part whose project is gone, the team-wide Head Coach with no project, a coach folder with generated role
 * instructions) is opened by a 2.0 daemon, which must fold it into plain projects. No network, no AI, no sessions run.
 *
 *   node tests/smoke/migrate.cjs [--keep]      (needs a build: npm run build)
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WS = require('ws');

const ROOT = path.resolve(__dirname, '..', '..');
const DAEMON = path.join(ROOT, 'out', 'daemon', 'index.js');
const KEEP = process.argv.includes('--keep');
const PORT = '47901';
const electron = require(path.join(ROOT, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agento-migrate-'));
const dataDir = path.join(tmp, 'data');
const repo = path.join(tmp, 'repo');
const other = path.join(tmp, 'other');
for (const d of [repo, other]) fs.mkdirSync(d, { recursive: true });

const t0 = Date.now();
const results = [];
const log = (...a) => console.log(`${String(Date.now() - t0).padStart(6)}ms  ${a.join(' ')}`);
function check(name, ok, detail = '') {
  results.push({ name, ok });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^CLAUDE(CODE|_PID|_CODE_)/.test(k)) env[k] = v;
  return env;
}
const daemonEnv = () => ({ ...cleanEnv(), ELECTRON_RUN_AS_NODE: '1', AGENTO_DATA_DIR: dataDir, ASM_PORT: PORT, ASM_VERSION: 'smoke', AGENTO_AUTO_FRESH: '0' });

let daemonProc = null;
async function startDaemon() {
  try { fs.unlinkSync(path.join(dataDir, 'daemon.json')); } catch { /* none */ }
  daemonProc = spawn(electron, [DAEMON], { env: daemonEnv(), stdio: 'ignore', detached: true, windowsHide: true });
  daemonProc.unref();
  const info = await until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'daemon.json'), 'utf8')); } catch { return null; }
  }, 15000);
  if (!info) throw new Error('the daemon did not write daemon.json');
  return info;
}
async function stopDaemon(info) {
  try { process.kill(info.pid); } catch { /* gone */ }
  await until(() => { try { process.kill(info.pid, 0); return false; } catch { return true; } }, 10000);
}
function welcome(info) {
  return new Promise((resolve, reject) => {
    const ws = new WS(`ws://127.0.0.1:${info.port}`);
    const timer = setTimeout(() => reject(new Error('no welcome')), 10000);
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: info.token, client: 'cli' })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type !== 'welcome') return;
      clearTimeout(timer);
      ws.close();
      resolve(m);
    });
  });
}
/** Run SQL against the data folder's database with the app's own better-sqlite3 (Electron as Node). */
function sql(script) {
  const code = `const D=require(${JSON.stringify(path.join(ROOT, 'node_modules', 'better-sqlite3'))});const db=new D(${JSON.stringify(path.join(dataDir, 'asm.db'))});${script};db.close();`;
  const r = spawnSync(electron, ['-e', code], { env: { ...cleanEnv(), ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return r.stdout;
}

async function main() {
  if (!fs.existsSync(DAEMON)) throw new Error(`no build: ${DAEMON} (run npm run build)`);
  log('data', dataDir);
  // a fresh 2.0 database, then turned into a 1.x one: the old columns and rows
  let info = await startDaemon();
  await welcome(info); // daemon.json is written before the database exists: wait until it answers
  await stopDaemon(info);
  const now = Date.now();
  const q = (v) => JSON.stringify(v);
  const session = (id, project, folder, order, role) =>
    `db.prepare("INSERT INTO sessions (id, project_id, folder_id, cwd, agent, title, status, created_at, updated_at, x, y, w, h, cols, rows, role, sort_order) VALUES (?, ?, ?, ?, 'shell', ?, 'done', ?, ?, 0, 0, 600, 1068, 100, 30, ?, ?)").run(${q(id)}, ${q(project)}, ${q(folder)}, ${q(repo)}, ${q(id)}, ${now}, ${now}, ${q(role)}, ${order === null ? 'null' : order})`;
  sql([
    "db.exec('ALTER TABLE projects ADD COLUMN parent_id TEXT')",
    "db.exec(\"ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'player'\")",
    "db.exec(\"DELETE FROM kv WHERE key = 'schema'\")",
    `db.prepare('INSERT INTO projects (id, name, created_at, color) VALUES (?, ?, ?, ?)').run('P', 'Shop', ${now}, '#2563eb')`,
    `db.prepare('INSERT INTO projects (id, name, created_at, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)').run('A', 'Dev', ${now + 1}, 'P', 1)`,
    `db.prepare('INSERT INTO projects (id, name, created_at, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)').run('B', 'QA', ${now + 2}, 'P', 2)`,
    `db.prepare('INSERT INTO projects (id, name, created_at, parent_id) VALUES (?, ?, ?, ?)').run('C', 'Lost part', ${now + 3}, 'GONE')`,
    `db.prepare('INSERT INTO folders (id, project_id, path, name) VALUES (?, ?, ?, ?)').run('fP', 'P', ${q(repo)}, 'repo')`,
    `db.prepare('INSERT INTO folders (id, project_id, path, name) VALUES (?, ?, ?, ?)').run('fA', 'A', ${q(repo + path.sep)}, 'repo')`,
    `db.prepare('INSERT INTO folders (id, project_id, path, name) VALUES (?, ?, ?, ?)').run('fB', 'B', ${q(other)}, 'other')`,
    session('sCoach', 'P', '', null, 'head'),
    session('sP', 'P', 'fP', 1, 'player'),
    session('sB', 'B', 'fB', 1, 'player'),
    session('sA', 'A', 'fA', 1, 'player'),
    session('sHead', '', '', null, 'head'),
    session('sC', 'C', '', null, 'player')
  ].join(';'));
  // 1.x role instructions in a coach folder (generated), and one the user took over (kept)
  const team = path.join(dataDir, 'team');
  fs.mkdirSync(path.join(team, 'head-P'), { recursive: true });
  fs.mkdirSync(path.join(team, 'head-coach'), { recursive: true });
  fs.writeFileSync(path.join(team, 'head-P', 'CLAUDE.md'), '<!-- agento:generated — delete this line to keep your own edits -->\n# Role: Head Coach\n');
  fs.writeFileSync(path.join(team, 'head-coach', 'CLAUDE.md'), '# my own notes\n');

  info = await startDaemon();
  const w = await welcome(info);
  const projects = w.projects;
  const sessions = new Map(w.sessions.map((s) => [s.id, s]));
  const byName = (n) => projects.find((p) => p.name === n);
  const shop = byName('Shop');

  check('parts are gone', !projects.some((p) => p.id === 'A' || p.id === 'B'), projects.map((p) => p.name).join(', '));
  check('no project has a parent', projects.every((p) => p.parentId === undefined));
  check("a part's sessions move into its project", sessions.get('sA')?.projectId === 'P' && sessions.get('sB')?.projectId === 'P');
  check('a part folder on the same path is merged into the project folder', sessions.get('sA')?.folderId === 'fP' && !shop?.folders.some((f) => f.id === 'fA'), shop?.folders.map((f) => f.id).join(','));
  check('any other part folder moves to the project', !!shop?.folders.some((f) => f.id === 'fB') && sessions.get('sB')?.folderId === 'fB');
  const order = ['sCoach', 'sP', 'sA', 'sB'].map((id) => sessions.get(id)?.order);
  check("the project's own sessions first, then the parts' in tree order", order.every((o, i) => i === 0 || (o ?? 0) > (order[i - 1] ?? 0)), order.join(' < '));
  check('a former coach stays in its project as a plain session', sessions.get('sCoach')?.projectId === 'P' && sessions.get('sCoach')?.role === undefined);
  const lost = projects.find((p) => p.id === 'C');
  check('a part whose project is gone becomes a project', !!lost && !!lost.color && sessions.get('sC')?.projectId === 'C');
  const archive = byName('Archive (1.x)');
  check('the team-wide Head Coach goes to a closed "Archive (1.x)"', !!archive && archive.closed === true && sessions.get('sHead')?.projectId === archive.id);
  check('generated role instructions are removed', !fs.existsSync(path.join(team, 'head-P', 'CLAUDE.md')));
  check("the user's own instruction file stays", fs.existsSync(path.join(team, 'head-coach', 'CLAUDE.md')));
  await stopDaemon(info);
  const schema = sql("process.stdout.write(String(db.prepare(\"SELECT value FROM kv WHERE key = 'schema'\").get()?.value))").trim();
  check('the migration is recorded (schema 2)', schema === '2', schema);

  // a second start changes nothing
  info = await startDaemon();
  const w2 = await welcome(info);
  check('a second start changes nothing', JSON.stringify(w2.projects.map((p) => [p.id, p.folders.length])) === JSON.stringify(projects.map((p) => [p.id, p.folders.length])));
  await stopDaemon(info);
}

main()
  .catch((e) => check('run', false, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (!KEEP) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* still in use */ }
    process.exit(failed ? 1 : 0);
  });
