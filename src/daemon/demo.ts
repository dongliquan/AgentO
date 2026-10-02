/**
 * Built-in demo — "Shop Team": planning · development · QA building a shop page in daily cycles.
 * Triggered by a secret order in the Orders tab (see DEMO_COMMANDS); the team appears on the Ground at once.
 *
 *   /demo shop [minutes]   (also: 데모 시작)  set up the workspace and team, start Day 1 now, a new day every N min
 *   /demo stop                              pause the daily routine
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
import type { Routines } from './routines';
import { log } from './log';
import { detectAgents } from './agents';
import type { CoachAgent } from './team';
import { arrangeTeam } from '@shared/layout';

const HERE = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const PROJECT = '쇼핑몰';
const ROUTINE = 'Daily stand-up · 쇼핑몰';
const DEFAULT_DAY_MIN = 10;

/** parts of the project → player titles (each part's coach is created by AgentO as "Coach · <part>") */
const PARTS: { part: string; coach: CoachAgent[]; players: string[] }[] = [
  // coaches on other vendors when their CLI is installed (questions and reviews), first installed one wins, Claude
  // last; all coding stays on Claude players
  { part: '기획', coach: ['codex', 'gemini'], players: ['기획자'] },
  { part: '개발', coach: ['claude'], players: ['개발자 1 · 상품목록', '개발자 2 · 장바구니'] },
  { part: '테스트', coach: ['gemini', 'codex'], players: ['테스터'] }
];
const AGENT_NAME: Record<CoachAgent, string> = { claude: 'Claude', codex: 'ChatGPT (Codex)', gemini: 'Gemini' };

const daily = (target: string): string => `[Day {day}] 쇼핑몰 화면 프로젝트의 하루를 진행해 주세요. 작업 폴더: ${target} — 규칙은 그 폴더의 CLAUDE.md, 제품은 BRIEF.md.
1. wbs.md 와 backlog.md 를 읽고, WBS 계획의 Day {day} 작업과 현재 상태를 보고 오늘 할 일을 정합니다. (Day 1 이면 BRIEF.md 로 착수합니다.)
2. 각 프로젝트의 코치에게 오늘 몫을 넘깁니다(send_to_session).
   - 기획: docs/requirements.md(REQ ID), design/wireframe.html, 개발·테스트 질의 응답
   - 개발: WBS 의 다음 구현 작업, 그리고 backlog.md 의 Open/Reopened 버그를 확인해 수정(→ Fixed, 비고에 수정 내용)
   - 테스트: tc/test-cases.md 와 tests/ 를 늘리고 npm test 와 화면 확인으로 테스트, Fixed 버그 검증(→ Verified/Reopened), 새 버그 backlog 등록
3. 코치들의 보고가 오면 wbs.md(상태·진행률)를 갱신하고 reports/daily/day-{day}.md(한 일, 진행 중, 버그 등록·수정, 위험, 내일 계획)를 씁니다.
4. 감독(저)에게 report_up 으로 하루 요약을 짧게 보고합니다.
하루 일은 작게 잡고, 못 끝낸 것은 내일로 넘겨 WBS 에 적어 주세요.`;

export type DemoCommand = { kind: 'start'; minutes: number } | { kind: 'stop' };

/** Recognize the secret demo orders; anything else is a normal order. */
export function parseDemoCommand(text: string): DemoCommand | null {
  const t = text.trim();
  const start = /^(?:\/demo\s+shop|데모\s*시작)(?:\s+(\d+))?$/i.exec(t);
  if (start) return { kind: 'start', minutes: Math.max(1, Number(start[1] ?? DEFAULT_DAY_MIN) || DEFAULT_DAY_MIN) };
  if (/^(?:\/demo\s+stop|데모\s*(?:중지|정지|멈춤))$/i.test(t)) return { kind: 'stop' };
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

  // AGENTO_DEMO_DIR: put the workspace elsewhere (tests)
  const target = path.resolve(process.env['AGENTO_DEMO_DIR'] || path.join(os.homedir(), 'AgentO-Demo', 'shop'));
  copyDir(templateDir(), target);
  const same = (a: string): boolean => path.resolve(a).toLowerCase() === target.toLowerCase();
  const all = (): StoredSession[] => d.sessions.list().map((s) => d.sessions.get(s.id)!);
  const projects = (): Project[] => d.store.listProjects();

  // the project and its parts; every part works in the same workspace folder (auto-trusted)
  const shop = projects().find((p) => p.name === PROJECT && !p.parentId) ?? d.store.createProject(PROJECT);
  for (const t of PARTS) {
    const part = projects().find((p) => p.parentId === shop.id && p.name === t.part) ?? d.store.createProject(t.part, shop.id);
    if (!part.folders.some((f) => same(f.path))) d.store.addFolder(part.id, target, path.basename(target), true);
  }
  d.onProjects();

  if (!all().some((s) => s.role === 'head' && s.projectId === shop.id)) d.team.createHead(shop.id);
  const installed = new Set(detectAgents().filter((a) => a.available).map((a) => a.kind));
  const partOf = (name: string): Project => projects().find((p) => p.parentId === shop.id && p.name === name)!;
  for (const t of PARTS) {
    const part = partOf(t.part);
    const folder = part.folders.find((f) => same(f.path))!;
    if (!all().some((s) => s.role === 'coach' && s.projectId === part.id)) {
      const agent: CoachAgent = t.coach.find((a) => installed.has(a)) ?? 'claude';
      d.team.createCoach(part.id, agent);
    }
    for (const title of t.players) {
      if (all().some((s) => s.projectId === part.id && s.title === title)) continue;
      d.sessions.create({ projectId: part.id, folderId: folder.id, cwd: folder.path, agent: 'claude', role: 'player', title });
    }
  }

  // Ground layout, as Auto Arrange (src/shared/layout.ts): only this project's cards move
  const mine = new Set(all().filter((s) => s.projectId === shop.id || projects().some((p) => p.parentId === shop.id && p.id === s.projectId)).map((s) => s.id));
  for (const [id, r] of arrangeTeam(all(), projects())) if (mine.has(id)) d.sessions.update(id, r);
  const head = all().find((s) => s.role === 'head' && s.projectId === shop.id);

  // the daily cycle: Day 1 now, then a new day every N minutes — sent to the project's head coach
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
  const coaches = PARTS.map((t) => {
    const part = partOf(t.part);
    const c = all().find((s) => s.role === 'coach' && s.projectId === part.id);
    const missing = c && c.agent !== t.coach[0] ? ` — ${AGENT_NAME[t.coach[0]!]} CLI not installed` : '';
    return `${t.part} ${c ? AGENT_NAME[c.agent as CoachAgent] ?? c.agent : '?'}${missing}`;
  }).join(', ');
  d.notify(
    `Demo "Shop Team" is on the Ground: project ${PROJECT} with parts 기획 · 개발 · 테스트 (coaches: ${coaches}), a new day every ${cmd.minutes} min (workspace ${target}). Stop it with /demo stop.`,
    head?.id ?? ''
  );
}
