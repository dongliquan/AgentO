#!/usr/bin/env node
/**
 * Daemon smoke test — a throwaway daemon (own data folder, own port) driven over its websocket and MCP endpoint.
 * Needs a build (`npm run build`); runs without network or AI calls (the session is a shell).
 *
 *   npm run smoke            (or: node tests/smoke/daemon.cjs [--keep])
 *
 * Checks: start · project + folder + memory file · shell session through a holder · terminal input/output ·
 * an order gets a task id · MCP tools/list · update_memory writes the memory · the permission tool holds until
 * answered · a daemon restart keeps the session (reattach) · project delete removes the session · shutdown.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const WS = require('ws');

const ROOT = path.resolve(__dirname, '..', '..');
const DAEMON = path.join(ROOT, 'out', 'daemon', 'index.js');
const KEEP = process.argv.includes('--keep');
const electron = require(path.join(ROOT, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agento-smoke-'));
const dataDir = path.join(tmp, 'data');
const work = path.join(tmp, 'work');
fs.mkdirSync(work, { recursive: true });

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

let daemonProc = null;
async function startDaemon() {
  if (!fs.existsSync(DAEMON)) throw new Error(`no build: ${DAEMON} (run npm run build)`);
  try { fs.unlinkSync(path.join(dataDir, 'daemon.json')); } catch { /* none */ }
  const env = { ...cleanEnv(), ELECTRON_RUN_AS_NODE: '1', AGENTO_DATA_DIR: dataDir, ASM_PORT: '47900', ASM_VERSION: 'smoke', AGENTO_AUTO_FRESH: '0' };
  daemonProc = spawn(electron, [DAEMON], { env, stdio: 'ignore', detached: true, windowsHide: true });
  daemonProc.unref();
  const info = await until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'daemon.json'), 'utf8')); } catch { return null; }
  }, 15000);
  if (!info) throw new Error('the daemon did not write daemon.json');
  return info;
}

/** A websocket client: collects every message; waitFor(pred) resolves with the first matching (past or future) one. */
function connect(info) {
  return new Promise((resolve, reject) => {
    const ws = new WS(`ws://127.0.0.1:${info.port}`);
    const msgs = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', token: info.token, client: 'cli' }));
      resolve({
        ws,
        msgs,
        send: (m) => ws.send(JSON.stringify(m)),
        waitFor: (pred, ms = 10000) => new Promise((res) => {
          const hit = msgs.find(pred);
          if (hit) return res(hit);
          const w = { pred, resolve: res };
          waiters.push(w);
          setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, ms);
        }),
        close: () => ws.close()
      });
    });
  });
}

function mcp(info, sessionId, method, params) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = http.request({ host: '127.0.0.1', port: info.port, path: `/mcp/${sessionId}`, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${info.token}`, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d, status: res.statusCode }); } });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end(body);
  });
}
const toolText = (r) => r?.result?.content?.[0]?.text ?? JSON.stringify(r?.error ?? r);

async function shutdown(c, info, killSessions) {
  c.send({ type: 'daemon.shutdown', killSessions });
  await until(() => { try { process.kill(info.pid, 0); return false; } catch { return true; } }, 10000);
  c.close();
}

async function main() {
  log(`data ${dataDir}`);
  // ---------- start ----------
  let info = await startDaemon();
  let c = await connect(info);
  const welcome = await c.waitFor((m) => m.type === 'welcome');
  check('daemon starts and greets', !!welcome, `pid ${info.pid}, port ${info.port}`);

  // ---------- project, folder, memory ----------
  c.send({ type: 'project.create', name: 'Smoke' });
  const p1 = await c.waitFor((m) => m.type === 'projects' && m.projects.some((p) => p.name === 'Smoke'));
  const project = p1?.projects.find((p) => p.name === 'Smoke');
  check('project created', !!project);
  c.send({ type: 'folder.add', projectId: project.id, path: work });
  const p2 = await c.waitFor((m) => m.type === 'projects' && m.projects.some((p) => p.id === project.id && p.folders.length));
  const folder = p2?.projects.find((p) => p.id === project.id).folders[0];
  check('folder added', !!folder);
  check('memory file exists', !!project.memory && fs.existsSync(project.memory), project.memory);

  // ---------- a shell session through a holder ----------
  c.send({ type: 'session.create', projectId: project.id, folderId: folder.id, agent: 'shell', title: 'smoke shell', cols: 100, rows: 30 });
  const up = await c.waitFor((m) => m.type === 'session.upsert' && m.session.title === 'smoke shell' && (m.session.status === 'working' || m.session.status === 'waiting'), 15000);
  const sid = up?.session.id;
  check('shell session starts', !!sid, up ? up.session.status : 'no status');
  const holderFile = sid && (await until(() => fs.existsSync(path.join(dataDir, 'holders', `${sid}.json`)), 10000));
  check('session runs in a holder', !!holderFile);
  c.send({ type: 'session.attach', id: sid });
  await sleep(1500);
  c.send({ type: 'session.input', id: sid, data: 'echo smoke-pty-ok\r' });
  const echoed = await c.waitFor((m) => m.type === 'session.data' && m.id === sid && m.data.includes('smoke-pty-ok'), 10000);
  check('terminal input and output', !!echoed);

  // ---------- restart (as a fresh start does): the new holder must come up while the old one is still closing ----------
  const mark = c.msgs.length;
  c.send({ type: 'session.restart', id: sid });
  const back = await until(() => {
    const ups = c.msgs.slice(mark).filter((m) => m.type === 'session.upsert' && m.session.id === sid).map((m) => m.session.status);
    return ups.includes('error') ? 'error' : ups.lastIndexOf('starting') >= 0 && /working|waiting/.test(ups[ups.length - 1] ?? '') ? ups[ups.length - 1] : null;
  }, 15000);
  await sleep(2500); // past the old holder's closing delay
  const errAfter = c.msgs.slice(mark).some((m) => m.type === 'session.upsert' && m.session.id === sid && m.session.status === 'error');
  check('session restart comes back (no error)', !!back && back !== 'error' && !errAfter, String(back));
  c.send({ type: 'session.attach', id: sid });
  await sleep(800);
  c.send({ type: 'session.input', id: sid, data: 'echo smoke-after-session-restart\r' });
  check('restarted session takes input', !!(await c.waitFor((m) => m.type === 'session.data' && m.id === sid && m.data.includes('smoke-after-session-restart'), 10000)));

  // ---------- an order gets a task id ----------
  c.send({ type: 'team.order', target: { kind: 'session', sessionId: sid }, text: 'echo smoke-order' });
  const rec = await c.waitFor((m) => m.type === 'inbox.delta' && m.upsert.some((i) => i.sessionId === sid && i.kind === 'directive'), 10000);
  const directive = rec?.upsert.find((i) => i.sessionId === sid && i.kind === 'directive');
  check('order recorded with a task id', !!directive?.taskId, directive?.taskId ?? 'none');

  // ---------- MCP ----------
  const list = await mcp(info, sid, 'tools/list', {});
  const names = (list?.result?.tools ?? []).map((t) => t.name);
  check('MCP tools/list', names.includes('update_memory') && names.includes('report_up'), names.join(','));
  const mem = await mcp(info, sid, 'tools/call', { name: 'update_memory', arguments: { section: 'Conventions', text: 'smoke convention line' } });
  const memText = fs.existsSync(project.memory) ? fs.readFileSync(project.memory, 'utf8') : '';
  check('update_memory writes the memory', memText.includes('- smoke convention line'), toolText(mem).slice(0, 80));
  const capped = await mcp(info, sid, 'tools/call', { name: 'update_memory', arguments: { section: 'Open', mode: 'replace', text: Array.from({ length: 21 }, (_, i) => `q${i}`).join('\n') } });
  check('memory caps are enforced', /cap/i.test(toolText(capped)));

  // ---------- the permission tool holds until answered ----------
  const pending = mcp(info, sid, 'tools/call', { name: 'permission', arguments: { tool_name: 'Bash', input: { command: 'echo smoke-perm' } } });
  const asked = await c.waitFor((m) => m.type === 'session.upsert' && m.session.id === sid && m.session.permission, 10000);
  check('permission request shows on the session', !!asked, asked?.session.permission?.tool);
  if (asked) c.send({ type: 'session.permission', id: sid, requestId: asked.session.permission.id, allow: true });
  const answer = await Promise.race([pending, sleep(10000).then(() => null)]);
  check('permission answer reaches the tool', /"behavior":"allow"/.test(toolText(answer)));

  // ---------- a daemon restart keeps the session ----------
  const pidBefore = (await c.waitFor((m) => m.type === 'session.upsert' && m.session.id === sid && m.session.pid))?.session.pid;
  await shutdown(c, info, false);
  const holderAlive = fs.existsSync(path.join(dataDir, 'holders', `${sid}.json`));
  check('shutdown leaves the holder running', holderAlive);
  info = await startDaemon();
  c = await connect(info);
  const w2 = await c.waitFor((m) => m.type === 'welcome');
  const again = w2?.sessions.find((s) => s.id === sid);
  check('restarted daemon reattaches the session', !!again && (again.status === 'waiting' || again.status === 'working'), again ? `${again.status}, pid ${again.pid} (was ${pidBefore})` : 'missing');
  c.send({ type: 'session.attach', id: sid });
  await sleep(800);
  c.send({ type: 'session.input', id: sid, data: 'echo smoke-after-restart\r' });
  const echoed2 = await c.waitFor((m) => m.type === 'session.data' && m.id === sid && m.data.includes('smoke-after-restart'), 10000);
  check('reattached session takes input', !!echoed2);

  // ---------- delete and stop ----------
  c.send({ type: 'project.delete', id: project.id });
  const gone = await c.waitFor((m) => m.type === 'session.removed' && m.id === sid, 10000);
  check('project delete removes its session', !!gone);
  const holderGone = await until(() => !fs.existsSync(path.join(dataDir, 'holders', `${sid}.json`)), 10000);
  check('the holder ends with the session', !!holderGone);
  await shutdown(c, info, true);
}

main()
  .catch((e) => check('run', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)))
  .finally(async () => {
    try { if (daemonProc) process.kill(daemonProc.pid); } catch { /* gone */ }
    await sleep(500);
    if (!KEEP) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a holder may still be closing */ }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — failed: ${failed.map((f) => f.name).join('; ')}` : ''}${KEEP ? `  (kept ${tmp})` : ''}`);
    process.exit(failed.length ? 1 : 0);
  });
