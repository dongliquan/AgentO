import type { InboxItem, Project, Session } from '@shared/protocol';
import { descendants, isDirect, type LogNode } from './threads';
import { orderProgress } from './progress';
import { projectColor, rootProject } from './format';

/**
 * The Timeline view (docs/history-view.md): a project's work as a git graph — the project is the main line, each part
 * a lane; a manager's order forks into the parts, a finished feature is one node (however many reports and commits it
 * took), and the order merges back to main once every feature is done. Built from the team threads only (no tokens).
 */
export type RowKind = 'order' | 'feature' | 'open' | 'merge';

export interface TimelineRow {
  key: string;
  kind: RowKind;
  ts: number;
  /** 0 = main (the project), 1.. = its parts */
  lane: number;
  title: string;
  /** the report's first line (feature), the order's progress (order / merge) */
  sub: string;
  sessionId?: string;
  /** commit hashes named in the feature's reports */
  hashes: string[];
  /** the order this row belongs to (forks and merges are drawn per order) */
  order: string;
  node: LogNode;
  /** the feature's final report */
  report?: InboxItem;
  /** reports the feature took */
  reports: number;
  /** the manager typed it to the session (their own words, often a short remark) */
  direct?: boolean;
}

export interface ProjectTimeline {
  projectId: string;
  name: string;
  color: string;
  lanes: { id: string; name: string }[];
  /** newest first */
  rows: TimelineRow[];
}

// a hash in a commit context ("커밋 ef9f918", "commit abc1234", "`0cc6338b7`"); must mix letters and digits
const HASH_CONTEXT = /(?:커밋|commit|머지|merge|해시|hash|push)[^\n`]{0,24}?`?([0-9a-f]{7,12})\b/gi;
const HASH_TICK = /`([0-9a-f]{7,12})`/g;

export function commitHashes(text: string): string[] {
  const out = new Set<string>();
  for (const re of [HASH_CONTEXT, HASH_TICK]) {
    for (const m of text.matchAll(re)) {
      const h = m[1]!.toLowerCase();
      if (/[a-f]/.test(h) && /\d/.test(h)) out.add(h.slice(0, 9));
    }
  }
  return [...out];
}

/** orders that are conversation, not work: a status check, a fresh start, a follow-up on another order */
const NOT_WORK = /^(?:Status check:|\[AgentO\] Fresh start|\(Follow-up on: |\[Daily changelog\])/;

/** The daily changelog routine: the project's coach lists the features its team finished that day (one reply). */
export const CHANGELOG_TAG = '[Daily changelog]';
export const CHANGELOG_ORDER = `${CHANGELOG_TAG} Today's report, from the reports you received — do not ask the players and do not read code. Two short lists, in the language you report in: "Done" — the features your team finished today, one line each as "part · feature" (or "No features today."); "Next" — what is in progress or comes next, and anything waiting on the manager. At most 7 lines each. Reply with the two lists only.`;

/** Each project's daily changelogs (the coach's reply to the routine), by day (Date.toDateString of the reply). */
export function changelogs(threads: LogNode[], sessions: Map<string, Session>, projects: Project[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const root of threads) {
    const it = root.item;
    if (it.fromId !== 'user' || !bodyOf(it).startsWith(CHANGELOG_TAG)) continue;
    const target = sessions.get(it.sessionId);
    const pid = target ? rootProject(target.projectId, projects)?.id ?? target.projectId : '';
    const reply = descendants(root).filter((r) => r.kind === 'report' && r.fromId === it.sessionId).pop();
    if (!reply) continue;
    const day = new Date(reply.createdAt).toDateString();
    const m = out.get(pid) ?? new Map<string, string>();
    m.set(day, bodyOf(reply).trim());
    out.set(pid, m);
  }
  return out;
}

/** The body of a record without its "<from> → <to>: " head and the daemon's "finished: (…N chars before)" marks. */
export const bodyOf = (it: InboxItem): string => {
  const i = it.text.indexOf(': ');
  return (i >= 0 ? it.text.slice(i + 2) : it.text)
    .replace(/^(?:finished|replied|stopped|failed)(?: \([^)]*\))?:\s*/, '')
    .replace(/^\(…\d+ chars before\)\s*/, '…');
};

/** A short title for an order or a feature: its first real line ("[New project]" → the brief's first line). */
export function titleOf(it: InboxItem): string {
  const body = bodyOf(it).replace(/^\[Order from [^\]]*\]\s*/, '');
  const brief = /\n(?:Brief from the manager|Brief):\s*\n([^\n]+)/.exec(body);
  if (/^\[New project\]/.test(body) && brief) return `New project — ${brief[1]!.trim()}`;
  const lines = body.split('\n').map((l) => l.replace(/^#+\s*|\*\*/g, '').trim()).filter(Boolean);
  const first = lines.find((l) => !/^\[[^\]]+\]$/.test(l)) ?? lines[0] ?? '';
  return first.length > 140 ? `${first.slice(0, 138)}…` : first;
}

/** a manager's direct message that only asks something short (not work): "아직 적용전인가?" */
const isQuestion = (it: InboxItem): boolean => {
  const b = bodyOf(it).trim();
  return b.length < 80 && /[?？]$/.test(b);
};

export function buildTimeline(threads: LogNode[], sessions: Map<string, Session>, projects: Project[], since: number): ProjectTimeline[] {
  const byProject = new Map<string, ProjectTimeline>();
  const timelineOf = (rootId: string): ProjectTimeline => {
    let t = byProject.get(rootId);
    if (!t) {
      const p = projects.find((x) => x.id === rootId);
      const parts = projects.filter((x) => x.parentId === rootId).sort((a, b) => a.createdAt - b.createdAt);
      t = {
        projectId: rootId,
        name: p?.name ?? 'Team',
        color: p ? projectColor(p.id, projects) : '#64748b',
        lanes: [{ id: rootId, name: p?.name ?? 'Team' }, ...parts.map((x) => ({ id: x.id, name: x.name }))],
        rows: []
      };
      byProject.set(rootId, t);
    }
    return t;
  };
  for (const root of threads) {
    const it = root.item;
    // the manager's orders, and direct messages that handed out work (not short questions)
    if (it.fromId !== 'user' || it.createdAt < since || NOT_WORK.test(bodyOf(it)) || (isDirect(it) && isQuestion(it))) continue;
    const target = sessions.get(it.sessionId);
    const rootId = target ? rootProject(target.projectId, projects)?.id ?? target.projectId : '';
    const tl = timelineOf(rootId);
    const laneOf = (s: Session | undefined): number => {
      if (!s) return 0;
      const i = tl.lanes.findIndex((l) => l.id === s.projectId);
      return i > 0 ? i : 0;
    };
    const pr = orderProgress(root, sessions);
    // the pieces of work: a directive nobody split further; an order a coordinator only answered is no work
    const pieces = pr.items.filter((w) => w.state !== 'replaced' && !(w.node === root && w.session && w.session.role !== 'player' && w.state === 'done'));
    if (pieces.length === 0) continue;
    const orderKey = it.id;
    // one piece of work: a single commit on its lane, named by the manager's words (no fork / merge rows to repeat it)
    const single = pieces.length === 1;
    if (!single) tl.rows.push({ key: `o:${it.id}`, kind: 'order', ts: it.createdAt, lane: 0, title: titleOf(it), sub: `${pr.done}/${pr.total} done${isDirect(it) ? ' · direct' : ''}`, hashes: [], order: orderKey, node: root, reports: 0 });
    let lastDone = 0;
    for (const w of pieces) {
      const n = w.node;
      const reports = descendants(n).filter((r) => r.kind === 'report' && r.fromId === n.item.sessionId);
      const final = reports[reports.length - 1];
      const hashes = [...new Set(reports.flatMap((r) => commitHashes(r.text)))];
      const done = w.state === 'done' && !!final;
      if (done) lastDone = Math.max(lastDone, final!.createdAt);
      tl.rows.push({
        key: `f:${n.item.id}`,
        kind: done ? 'feature' : 'open',
        ts: done ? final!.createdAt : n.item.createdAt,
        lane: laneOf(w.session),
        // the feature is what was asked (the manager's own words for a single piece); its report says how it ended
        // a one-word answer ("1", "네, 그렇게 해 주세요.") names nothing: then the report says what the feature was
        title: (() => {
          const asked = titleOf(single ? it : n.item);
          const said = final ? titleOf(final) : '';
          const closing = /^(?:완료했습니다|끝났습니다|확인했습니다|정리했습니다|done|finished|all set)[.!]?$/i.test(said);
          return asked.replace(/[\s.。!]+$/, '').length < 14 && said && !closing ? said : asked;
        })(),
        sub: done ? titleOf(final!) : w.state,
        ...(w.session ? { sessionId: w.session.id } : {}),
        hashes,
        order: orderKey,
        node: n,
        ...(final ? { report: final } : {}),
        ...(single && isDirect(it) ? { direct: true } : {}),
        reports: reports.length
      });
    }
    if (!single && pieces.every((w) => w.state === 'done') && lastDone) {
      tl.rows.push({ key: `m:${it.id}`, kind: 'merge', ts: lastDone + 1, lane: 0, title: titleOf(it), sub: `${pieces.length} feature${pieces.length > 1 ? 's' : ''} done`, hashes: [], order: orderKey, node: root, reports: 0 });
    }
  }
  const out = [...byProject.values()];
  for (const t of out) t.rows.sort((a, b) => b.ts - a.ts);
  // projects in the sidebar's order, the team (no project) last
  const order = new Map(projects.filter((p) => !p.parentId).map((p, i) => [p.id, i]));
  return out.sort((a, b) => (order.get(a.projectId) ?? 1e9) - (order.get(b.projectId) ?? 1e9));
}

/** The feature line a player starts its report with ("Feature: …" / "기능: …"), if any. */
export function featureLine(report: InboxItem | undefined): string | undefined {
  if (!report) return undefined;
  const head = bodyOf(report).split('\n').slice(0, 6).join('\n');
  const m = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:Feature|기능)\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/im.exec(head);
  return m?.[1]?.trim() || undefined;
}

/** What a feature added, as short as it is known: the report's feature line, a commit subject, else what was asked. */
export function featureName(r: TimelineRow, subjects: Record<string, string>): string {
  const line = featureLine(r.report);
  if (line) return line;
  for (const h of r.hashes) {
    const sub = subjects[h];
    if (sub) return sub;
  }
  // what was asked, unless it is a path or a long instruction: then the report's first line (what was done)
  const said = r.report ? titleOf(r.report) : '';
  // a closing line ("완료했습니다.", "Done.") names nothing
  const generic = /^(?:완료했습니다|끝났습니다|확인했습니다|정리했습니다|done|finished|all set)[.!]?$/i.test(said);
  // the report's first line says what was built; the ask is kept only when the report line is a mere closing
  const usable = said && !generic && !said.startsWith('…') && said.length <= 120;
  const vague = /^(?:[A-Za-z]:\\|\[|\(|https?:)/.test(r.title) || r.title.length > 70;
  return usable && (vague || r.direct) ? said : r.title;
}

const NO_CHANGE = /조사만|확인만|수정 금지|수정하지 말|수정·커밋 안 함|수정 안 함|결함 없음|변경 없음|read-only|no changes|do not (?:change|edit)/i;

// a report that says something was built or changed (not only checked, answered or looked into)
const CHANGED = /구현|추가|수정|반영|변경|개선|신설|삭제했|교체|적용|만들었|고쳤|포팅|머지|merged|implement|added|fixed|changed|refactor|built a|new (?:feature|tab|view|button)/i;

/** A feature, not just an exchange: the report names one, names a commit, or says what it built or changed. */
export function isFeature(r: TimelineRow): boolean {
  if (r.kind !== 'feature') return false;
  if (featureLine(r.report)) return true;
  // a question ("왜 그럴까?") or asked only to look into something, or it found nothing to change
  if (/[?？]\s*$/.test(bodyOf(r.node.item).trim()) && !r.hashes.length) return false;
  if (NO_CHANGE.test(bodyOf(r.node.item).slice(0, 300)) || (r.report && NO_CHANGE.test(bodyOf(r.report).slice(0, 300)))) return false;
  if (r.hashes.length) return true;
  return r.report ? CHANGED.test(bodyOf(r.report).slice(0, 600)) : false;
}

/** A ticket / issue key in a feature's words ("PROJ-1587", "Shop-212"). */
const TICKET = /\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)*-\d{2,6})\b/;

export interface FeatureGroup {
  key: string;
  /** the feature: its ticket and best name */
  title: string;
  ticket?: string;
  /** the changes that made it (newest first) */
  rows: TimelineRow[];
  hashes: string[];
  lastAt: number;
}

/**
 * Finished pieces grouped into features, whoever did them: pieces naming the same ticket are one feature, otherwise
 * pieces with the same name. The title prefers a commit subject or feature line, then the shortest clear name.
 */
export function featureGroups(rows: TimelineRow[], subjects: Record<string, string>): FeatureGroup[] {
  const groups = new Map<string, FeatureGroup>();
  for (const r of rows) {
    const name = featureName(r, subjects);
    const text = `${name}\n${r.title}\n${r.report ? bodyOf(r.report).slice(0, 400) : ''}`;
    const ticket = TICKET.exec(text)?.[1];
    const key = ticket ?? name.toLowerCase().replace(/\s+/g, ' ').replace(/[.。!]+$/, '').slice(0, 60);
    const g = groups.get(key) ?? { key, title: name, ...(ticket ? { ticket } : {}), rows: [], hashes: [], lastAt: 0 };
    g.rows.push(r);
    g.hashes = [...new Set([...g.hashes, ...r.hashes])];
    g.lastAt = Math.max(g.lastAt, r.ts);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    // the clearest name among its changes: a commit subject / feature line first, then the shortest one
    const named = g.rows.map((r) => featureName(r, subjects));
    const best = named.find((n, i) => n !== g.rows[i]!.title) ?? [...named].sort((a, b) => a.length - b.length)[0]!;
    g.title = g.ticket && !best.includes(g.ticket) ? `${g.ticket} · ${best}` : best;
    g.rows.sort((a, b) => b.ts - a.ts);
  }
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt);
}
