/**
 * Built-in demo — "Shop Team": planning · development · QA building a shop page in daily cycles, on the team's
 * current mechanics: one project Coach (PM, headless) hands tasks straight to headless players, a Codex reviewer
 * cross-checks finished pieces, the project memory carries the rules, every task has its #T id, and the manager gets
 * one report a day. Triggered by secret orders in the Orders tab (see DEMO_COMMANDS).
 *
 *   /demo shop [fresh] [minutes]   (also: 데모 시작)  set up the workspace and team, start Day 1 now, a new day every
 *                                                     N min; "fresh" removes an earlier demo first
 *   /demo stop                     (데모 중지)         pause the daily routine
 *   /demo reset                    (데모 초기화)       remove the demo project and set the workspace aside
 *
 * The workspace template ships in demo/shop-team/workspace (packaged: resources/demo/…); it is copied to
 * ~/AgentO-Demo/shop (existing files are kept). Re-running reuses the projects and sessions that already exist.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Project } from '@shared/protocol';
import type { Store, StoredSession } from './store';
import type { SessionManager } from './sessions';
import type { Team } from './team';
import { REVIEWER_TITLE } from './team';
import type { Routines } from './routines';
import { log } from './log';
import { detectAgents } from './agents';
import { arrangeTeam } from '@shared/layout';
import { memorySystemPrompt, updateMemory } from './memory';

const HERE = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const PROJECT = '쇼핑몰';
const ROUTINE = 'Daily stand-up · 쇼핑몰';
const DEFAULT_DAY_MIN = 10;

/** parts of the project → player titles; no part coaches — the project Coach directs the players itself */
const PARTS: { part: string; players: string[] }[] = [
  { part: '기획', players: ['기획자'] },
  { part: '개발', players: ['개발자 1 · 상품목록', '개발자 2 · 장바구니'] },
  { part: '테스트', players: ['테스터'] }
];

/** the day's order to the project Coach (the routine's text; {day} is filled by the routine) */
const daily = (target: string): string => `[Day {day}] 쇼핑몰 화면 프로젝트의 하루를 진행해 주세요. 작업 폴더: ${target} — 규칙은 CLAUDE.md, 제품은 BRIEF.md, 계획은 wbs.md, 버그는 backlog.md.
1. wbs.md 와 backlog.md 를 읽고 Day {day} 의 할 일을 정합니다. (Day 1 이면 BRIEF.md 로 착수합니다.)
2. 선수에게 직접 지시합니다(send_to_session, 선수마다 관련 일을 한 메시지에 묶어서):
   - 기획자: docs/requirements.md(REQ ID), design/wireframe.html, 개발·테스트의 질문 답변. 그리고 하루 끝에 wbs.md(상태·진행률)와 reports/daily/day-{day}.md 갱신(당신 지시대로).
   - 개발자 1·2: WBS 의 다음 구현 작업, backlog.md 의 Open/Reopened 버그 수정(→ Fixed, 비고에 수정 내용).
   - 테스터: tc/test-cases.md 와 tests/ 보강, npm test 와 화면 확인, Fixed 버그 검증(→ Verified/Reopened), 새 버그 등록.
3. 선수가 끝나면 보고가 자동으로 옵니다. 코드가 바뀐 조각은 "${REVIEWER_TITLE}" 세션에 확인할 것(목표·바뀐 파일·확인 방법)을 보내 교차 검증하고, 문제는 해당 선수에게 돌려보냅니다.
4. 결정·관례·함정이 생기면 update_memory 로 프로젝트 메모리에 한 줄씩 남깁니다(낡은 줄은 교체).
5. 하루가 끝나면 감독에게 **한 번만** report_up: 끝낸 기능(기능: … 한 줄씩), 미해결 버그 수, 결정이 필요한 것. 진행 메모는 보내지 않습니다.
하루 일은 작게 잡고, 못 끝낸 것은 WBS 에 내일로 적게 해 주세요.`;

/** the project memory a new demo starts with (the rules every session should know without reading the folder) */
const MEMORY_SEED: { section: 'Conventions' | 'Map' | "Don't"; lines: string }[] = [
  {
    section: 'Conventions',
    lines: `문서·보고·커밋 메시지는 한국어
자동 테스트는 Node 내장(node --test), 실행은 npm test; 외부 패키지를 설치하지 않는다
버그는 backlog.md 한 행(BUG-001 …): Open → Fixed(개발, 비고에 수정 내용) → Verified/Reopened(테스터) → Closed; 행은 지우지 않는다
요건은 REQ-01 … ID 로, 테스트 케이스는 TC ID 로 REQ 와 연결
끝난 일은 답의 첫 줄을 "기능: …" 으로 시작한다`
  },
  {
    section: 'Map',
    lines: `규칙 CLAUDE.md · 제품 BRIEF.md · 계획 wbs.md · 버그 backlog.md · 일일 보고 reports/daily/day-N.md
화면 src/index.html · 상품 목록 src/products.js · 장바구니 src/cart.js · 상품 데이터 src/data/products.json
요건 docs/requirements.md · 화면 설계 design/wireframe.html · 테스트 케이스 tc/test-cases.md · 자동 테스트 tests/`
  },
  {
    section: "Don't",
    lines: `자기 영역 밖의 파일은 고치지 않는다: src 는 개발, tc·tests 는 테스트, docs·design 은 기획, wbs·reports 는 Coach 의 지시로 기획자가
빌드 도구·프레임워크를 들이지 않는다 — 순수 HTML/CSS/JS(ES 모듈), 브라우저로 src/index.html 을 바로 연다
끝난 일에 report_up 하지 않는다 — 마지막 답이 곧 보고다(막혔거나 결정이 필요할 때만 report_up)`
  }
];

export type DemoCommand = { kind: 'start'; minutes: number; fresh: boolean } | { kind: 'stop' } | { kind: 'reset' };

/** Recognize the secret demo orders; anything else is a normal order. */
export function parseDemoCommand(text: string): DemoCommand | null {
  const t = text.trim();
  const start = /^(?:\/demo\s+shop|데모\s*시작)(?:\s+(fresh|새로))?(?:\s+(\d+))?$/i.exec(t);
  if (start) return { kind: 'start', fresh: !!start[1], minutes: Math.max(1, Number(start[2] ?? DEFAULT_DAY_MIN) || DEFAULT_DAY_MIN) };
  if (/^(?:\/demo\s+stop|데모\s*(?:중지|정지|멈춤))$/i.test(t)) return { kind: 'stop' };
  if (/^(?:\/demo\s+reset|데모\s*(?:초기화|삭제|리셋))$/i.test(t)) return { kind: 'reset' };
  return null;
}

function templateDir(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'demo', 'shop-team', 'workspace'),
    path.join(HERE, '..', '..', 'demo', 'shop-team', 'workspace')
  ];
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'BRIEF.md')));
  if (!found) throw new Error('The demo template (demo/shop-team/workspace) is missing');
  return found;
}

/** Copy the template without overwriting the team's work from an earlier run. */
function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else if (!fs.existsSync(b)) fs.copyFileSync(a, b);
  }
}

export interface DemoDeps {
  store: Store;
  sessions: SessionManager;
  team: Team;
  routines: Routines;
  /** projects changed (folders/projects created) */
  onProjects: () => void;
  /** a message for the user's inbox, shown under that session */
  notify: (text: string, sessionId: string) => void;
  /** remove a project with its parts, sessions, records and routines (the server's project.delete) */
  deleteProject: (id: string) => void;
}

const workspaceDir = (): string => path.resolve(process.env['AGENTO_DEMO_DIR'] || path.join(os.homedir(), 'AgentO-Demo', 'shop'));

/** The demo project goes; the workspace folder is set aside as shop.bak-<stamp> (nothing is deleted on disk). */
function removeDemo(d: DemoDeps): string[] {
  const notes: string[] = [];
  const shop = d.store.listProjects().find((p) => p.name === PROJECT && !p.parentId);
  if (shop) {
    d.deleteProject(shop.id);
    notes.push(`project "${PROJECT}" removed`);
  }
  const target = workspaceDir();
  if (fs.existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    const aside = `${target}.bak-${stamp}`;
    fs.renameSync(target, aside);
    notes.push(`workspace set aside as ${aside}`);
  }
  return notes;
}

export function runDemo(cmd: DemoCommand, d: DemoDeps): void {
  if (cmd.kind === 'stop') {
    const r = d.routines.list().find((x) => x.name === ROUTINE);
    if (!r) throw new Error('No demo is running');
    d.routines.save({ id: r.id, name: r.name, target: r.target, text: r.text, enabled: false, ...(r.dailyAt ? { dailyAt: r.dailyAt } : { everyMinutes: r.everyMinutes ?? DEFAULT_DAY_MIN }) });
    const shop = d.store.listProjects().find((p) => p.name === PROJECT && !p.parentId);
    d.notify(`Demo paused after day ${r.runs}. Resume "${ROUTINE}" in the Orders tab to continue.`, (shop && d.team.headOf(shop.id)?.id) ?? '');
    return;
  }
  if (cmd.kind === 'reset') {
    const notes = removeDemo(d);
    d.onProjects();
    d.notify(notes.length ? `Demo reset: ${notes.join('; ')}. "/demo shop" builds it again.` : 'No demo to reset.', '');
    return;
  }

  const notes: string[] = [];
  if (cmd.fresh) notes.push(...removeDemo(d));
  const target = workspaceDir();
  copyDir(templateDir(), target);
  const same = (a: string): boolean => path.resolve(a).toLowerCase() === target.toLowerCase();
  const all = (): StoredSession[] => d.sessions.list().map((s) => d.sessions.get(s.id)!);
  const projects = (): Project[] => d.store.listProjects();

  // the project (the reviewer's folder) and its parts; every part works in the same workspace folder (auto-trusted)
  const shop = projects().find((p) => p.name === PROJECT && !p.parentId) ?? d.store.createProject(PROJECT);
  if (!shop.folders.some((f) => same(f.path))) d.store.addFolder(shop.id, target, path.basename(target), true);
  for (const t of PARTS) {
    const part = projects().find((p) => p.parentId === shop.id && p.name === t.part) ?? d.store.createProject(t.part, shop.id);
    if (!part.folders.some((f) => same(f.path))) d.store.addFolder(part.id, target, path.basename(target), true);
  }
  d.onProjects();

  // the Coach (PM): directs the players itself; part coaches from an earlier demo are retired
  if (!all().some((s) => s.role === 'head' && s.projectId === shop.id)) d.team.createHead(shop.id);
  const partIds = new Set(projects().filter((p) => p.parentId === shop.id).map((p) => p.id));
  for (const c of all().filter((s) => s.role === 'coach' && partIds.has(s.projectId))) {
    d.sessions.remove(c.id);
    notes.push(`part coach "${c.title}" retired`);
  }
  const partOf = (name: string): Project => projects().find((p) => p.parentId === shop.id && p.name === name)!;
  for (const t of PARTS) {
    const part = partOf(t.part);
    const folder = part.folders.find((f) => same(f.path))!;
    for (const title of t.players) {
      if (all().some((s) => s.projectId === part.id && s.title === title)) continue;
      // headless by default: the team's players run JSON in / out
      d.sessions.create({ projectId: part.id, folderId: folder.id, cwd: folder.path, agent: 'claude', role: 'player', title });
    }
  }
  // the cross-check reviewer (a second model), stopped until the Coach sends it something
  const codex = detectAgents().find((a) => a.kind === 'codex')?.available;
  const projectFolder = projects().find((p) => p.id === shop.id)!.folders.find((f) => same(f.path))!;
  if (codex && !all().some((s) => s.projectId === shop.id && s.title === REVIEWER_TITLE)) {
    d.sessions.restore({ projectId: shop.id, folderId: projectFolder.id, cwd: projectFolder.path, agent: 'codex', role: 'player', title: REVIEWER_TITLE });
  } else if (!codex) notes.push('Codex CLI not installed: no reviewer');

  // the project memory: the rules, so sessions start short (only when it is still empty)
  if (!memorySystemPrompt(shop.id, PROJECT)) {
    for (const m of MEMORY_SEED) {
      const r = updateMemory(shop.id, PROJECT, m.section, m.lines, 'replace');
      if ('error' in r) log.warn('demo: memory seed', m.section, r.error);
    }
  }

  // Ground layout, as Auto Arrange (src/shared/layout.ts): only this project's cards move
  const mine = new Set(all().filter((s) => s.projectId === shop.id || partIds.has(s.projectId)).map((s) => s.id));
  for (const [id, r] of arrangeTeam(all(), projects())) if (mine.has(id)) d.sessions.update(id, r);
  const head = all().find((s) => s.role === 'head' && s.projectId === shop.id);

  // the daily cycle: Day 1 now, then a new day every N minutes — sent to the project's Coach
  const prev = d.routines.list().find((r) => r.name === ROUTINE);
  d.routines.save({
    ...(prev ? { id: prev.id } : {}),
    name: ROUTINE,
    target: { kind: 'project', projectId: shop.id },
    text: daily(target),
    everyMinutes: cmd.minutes,
    enabled: true,
    runNow: true
  });
  log.info('demo: shop team ready at', target);
  const players = PARTS.flatMap((t) => t.players).length;
  d.notify(
    `Demo "Shop Team" is on the Ground: project ${PROJECT} — Coach (PM) → ${players} headless players in 기획 · 개발 · 테스트${codex ? `, "${REVIEWER_TITLE}" for cross-checks` : ''}; project memory seeded; a new day every ${cmd.minutes} min (workspace ${target}).${notes.length ? ` ${notes.join('; ')}.` : ''} Stop with /demo stop, remove with /demo reset.`,
    head?.id ?? ''
  );
}
