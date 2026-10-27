#!/usr/bin/env node
/**
 * UI smoke test — read-only checks over the Chrome DevTools protocol against a running AgentO window started with
 * `--remote-debugging-port=9334` (e.g. `AgentO.exe --remote-debugging-port=9334`). It switches views and tabs and puts
 * them back; it sends nothing to the daemon.
 *
 *   npm run smoke:ui          (or: node tests/smoke/ui.cjs [port])
 */
const http = require('node:http');
const WS = require('ws');

const PORT = Number(process.argv[2]) || 9334;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function page() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json/list`, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        const p = JSON.parse(d).find((t) => t.type === 'page' && !/viewer|panels/.test(t.url));
        p ? resolve(p) : reject(new Error('no AgentO page'));
      });
    }).on('error', () => reject(new Error(`no AgentO with --remote-debugging-port=${PORT}`)));
  });
}

async function main() {
  const target = await page();
  const ws = new WS(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', (m) => { const j = JSON.parse(m); if (pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } });
  /** evaluate an expression in the page and return its JSON value */
  const ev = (expr) => new Promise((res) => {
    pending.set(++id, (j) => res(j.result?.result?.value));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(() => { try { return JSON.stringify(${expr}); } catch (e) { return JSON.stringify({ error: String(e) }); } })()`, returnByValue: true } }));
  }).then((v) => (typeof v === 'string' ? JSON.parse(v) : v));
  const click = (sel, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (b) b.click(); return !!b; })()`);

  // where things are now, to put them back
  const start = await ev(`({ view: document.querySelector('.segmented button.active')?.textContent.trim(), tab: document.querySelector('.rp-tabs button.active')?.textContent.trim(), panel: !!document.querySelector('.rightpanel') })`);

  check('connected to the daemon', await ev(`/Connected/.test(document.querySelector('.statusbar')?.textContent || '')`));
  const tree = await ev(`({ projects: [...document.querySelectorAll('.tree .tree-project .label')].map(l => l.textContent.trim()), parts: [...document.querySelectorAll('.tree .tree-part .label')].map(l => l.textContent.trim()) })`);
  check('project rows show their session count', tree.projects.length > 0 && tree.projects.every((t) => /\(\d+\)$/.test(t) || !/\d/.test(t)), tree.projects.slice(0, 3).join(', '));
  check('part rows show no count', tree.parts.every((t) => !/\(\d+\)$/.test(t)));
  check('one color control per project row', await ev(`[...document.querySelectorAll('.tree .tree-project')].every(r => r.querySelectorAll('.tree-pc').length === 1 && !r.querySelector('.pc-pick'))`));
  check('project coach sits on the project row', await ev(`[...document.querySelectorAll('.tree .tree-project')].some(r => r.querySelector('.tree-coach'))`));
  check('left sidebar shows no folder rows', await ev(`!document.querySelector('.sidebar .tree-folders') && !document.querySelector('.sidebar .chips')`));

  // views
  for (const v of ['Ground', 'Split', 'Tabs']) {
    await click('.segmented button', v);
    await sleep(500);
    const shown = await ev(`({ board: !!document.querySelector('.board'), split: !!document.querySelector('.split'), tabs: !!document.querySelector('.tabview') })`);
    check(`view ${v}`, v === 'Ground' ? shown.board : v === 'Split' ? shown.split : shown.tabs);
    if (v === 'Split') check('Split tag strip sits above the card header', await ev(`(() => { const c = document.querySelector('.split .cell'); if (!c) return true; const t = c.querySelector('.cell-tag')?.getBoundingClientRect(); const h = c.querySelector('.card-header')?.getBoundingClientRect(); return !t || !h || t.bottom <= h.top + 1; })()`));
    if (v === 'Tabs') check('Tabs has a project-group row', await ev(`document.querySelectorAll('.tab-projects .tab-project').length > 0`));
  }
  await click('button', 'Timeline');
  await sleep(500);
  check('view Timeline', await ev(`!!document.querySelector('.timeline, .tl-view, [class*=timeline]')`));
  await click('.segmented button', 'Today');
  await sleep(500);
  const today = await ev(`({ cards: [...document.querySelectorAll('.today-card h3')].map(h => h.textContent.replace(/\d+$/, '').trim()), tools: !!document.querySelector('.toolbar .btn.ghost[title^="Auto Arrange"]') })`);
  check('view Today has its four cards', ['Needs you', 'Working now', 'Done today', 'To do'].every((c) => today.cards?.some((x) => x.startsWith(c))), (today.cards || []).join(' · '));
  check('layout tools hide on Today', !today.tools);

  // right panel
  if (!start.panel) await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, altKey: true, bubbles: true }))`);
  await sleep(300);
  const tabs = await ev(`[...document.querySelectorAll('.rp-tabs button')].map(b => ({ t: b.textContent.trim(), cut: b.scrollWidth > b.clientWidth + 1 }))`);
  check('right panel tabs include Files', tabs.some((t) => t.t.startsWith('Files')), tabs.map((t) => t.t).join(' · '));
  check('right panel tab labels are not cut', tabs.every((t) => !t.cut));
  await click('.rp-tabs button', 'Files');
  await sleep(600);
  check('Files tab shows a project with folders', await ev(`!!document.querySelector('.files-panel .files-head') && document.querySelectorAll('.files-tree .tree-row').length > 0`));
  check('Files tab has the Memory button', await ev(`!!document.querySelector('.files-memory')`));
  check('file badges are ReadO style', await ev(`(() => { const b = document.querySelector('.files-tree .fbadge'); return !b || getComputedStyle(b).borderStyle !== 'none'; })()`));
  check('composer Send button matches the field', await ev(`(() => { const c = document.querySelector('.chat-composer'); if (!c) return true; const a = c.querySelector('textarea').getBoundingClientRect(), b = c.querySelector('.btn').getBoundingClientRect(); return Math.abs(a.height - b.height) < 2; })()`));

  // put things back
  if (start.view) await click('.segmented button', start.view);
  if (start.tab) await click('.rp-tabs button', start.tab.replace(/\d+$/, ''));
  if (!start.panel) await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, altKey: true, bubbles: true }))`);
  ws.close();
}

main()
  .catch((e) => check('run', false, e.message))
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — failed: ${failed.map((f) => f.name).join('; ')}` : ''}`);
    process.exit(failed.length ? 1 : 0);
  });
