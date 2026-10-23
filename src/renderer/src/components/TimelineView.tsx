import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { selectAndReveal } from '@/commands';
import { useOpenThreads } from '@/lib/closed';
import { useDraft } from '@/lib/draft';
import { useTalkProject } from '@/lib/talkFilter';
import { useGitSubjects } from '@/lib/gitSubjects';
import { bodyOf, buildTimeline, changelogs, CHANGELOG_ORDER, CHANGELOG_TAG, featureName, isFeature, type ProjectTimeline, type TimelineRow } from '@/lib/timeline';
import { dayTime, displayTitle, formatDateTime, pcStyle, roleLabel } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { matches } from '@/lib/search';
import { useNow } from '@/lib/hooks';
import { ProjectFilter } from './ProjectFilter';
import { SearchBox } from './SearchBox';
import { useFlow } from './OrderFlow';
import { copyPath } from './PathMenu';
import { useReport } from './DailyReport';

const PERIODS = [
  { id: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { id: '30d', label: '30 days', ms: 30 * 86_400_000 },
  { id: 'all', label: 'All', ms: Infinity }
] as const;

/** One session's branch of the tree: its features, newest first. */
interface SessionNode {
  id: string;
  name: string;
  role?: string;
  rows: TimelineRow[];
}
interface PartNode {
  id: string;
  name: string;
  sessions: SessionNode[];
}
interface Tree {
  id: string;
  name: string;
  color: string;
  coach: SessionNode[];
  parts: PartNode[];
  count: number;
  done: number;
  open: number;
}

/**
 * Timeline as a tree: project ▸ coach / parts ▸ sessions ▸ the features each one finished (newest first, with the
 * date), so what was added, where and by whom reads at a glance. A feature is named by the player's "Feature:" line,
 * else its commit subject, else what was asked. Click one for the details on the right. Built from the team records.
 */
export function TimelineView(): JSX.Element {
  const threads = useOpenThreads();
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const subjects = useGitSubjects((s) => s.subjects);
  const pick = useTalkProject((s) => s.project);
  const setPick = useTalkProject((s) => s.setProject);
  const [period, setPeriod] = useDraft<string>('timeline.period', '30d');
  const [openToo, setOpenToo] = useDraft<boolean>('timeline.open2', false);
  const [everything, setEverything] = useDraft<boolean>('timeline.everything', false);
  const [query, setQuery] = useState('');
  // session filter: the legend's sessions picked to show alone (none = all)
  const [only, setOnly] = useDraft<string[]>('timeline.sessions', []);
  const toggleOnly = (id: string): void => setOnly(only.includes(id) ? only.filter((x) => x !== id) : [...only, id]);
  const [sel, setSel] = useState<string | null>(null);
  const now = useNow(60_000);
  const since = now - (PERIODS.find((p) => p.id === period)?.ms ?? Infinity);

  const all = useMemo(() => buildTimeline(threads, sessions, projects, Number.isFinite(since) ? since : 0), [threads, sessions, projects, since]);
  const logs = useMemo(() => changelogs(threads, sessions, projects), [threads, sessions, projects]);
  // days fold to one line; the last three are open unless closed by hand
  const [dayOpen, setDayOpen] = useState<Record<string, boolean>>({});
  const toggleDay = (key: string, open: boolean): void => setDayOpen({ ...dayOpen, [key]: !open });
  const trees = useMemo(
    () => all.filter((t) => !pick || t.projectId === pick).map((t) => treeOf(t, sessions, subjects, query, openToo, everything)).filter((t) => t.count > 0),
    [all, pick, sessions, subjects, query, openToo, everything]
  );

  // name features by their commits: ask the daemon for the subjects of hashes it has not looked up yet
  useEffect(() => {
    const st = useGitSubjects.getState();
    for (const t of all) {
      const hashes = [...new Set(t.rows.flatMap((r) => r.hashes))].filter((h) => !st.asked.has(h));
      if (!hashes.length) continue;
      hashes.forEach((h) => st.asked.add(h));
      const folders = projects.filter((p) => p.id === t.projectId || p.parentId === t.projectId).flatMap((p) => p.folders.map((f) => f.path));
      if (folders.length) send({ type: 'git.subjects', folders, hashes });
    }
  }, [all, projects]);

  const selected = useMemo(() => {
    for (const t of all) for (const r of t.rows) if (r.key === sel) return { t, r };
    return null;
  }, [all, sel]);

  return (
    <div className="timeline">
      <div className="timeline-bar">
        <ProjectFilter value={pick} onChange={setPick} />
        <div className="segmented sm" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.id} className={period === p.id ? 'active' : ''} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
        <label className="tl-check" title="Also list work that is not finished yet">
          <input type="checkbox" checked={openToo} onChange={(e) => setOpenToo(e.target.checked)} /> In progress
        </label>
        <label className="tl-check" title="Also list finished work that only checked, answered or looked into something">
          <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.target.checked)} /> All finished work
        </label>
        <SearchBox value={query} onChange={setQuery} placeholder="Search features, commits" />
        <span className="grow" />
        <button className="btn sm" onClick={() => useReport.getState().show()} title="Report: what was done each day, and the to-do list for the next">Report</button>
      </div>
      <div className="timeline-body">
        <div className="timeline-graphs">
          {trees.length === 0 && <div className="tree-empty">No features in this period. Work ordered from the Manager tab (or typed to a session) shows up here once it is done.</div>}
          {trees.map((t) => (
            <ProjectLanes key={t.id} t={t} selected={sel} onSelect={setSel} now={now} only={only} onToggle={toggleOnly} onAll={() => setOnly([])} log={logs.get(t.id)} dayOpen={dayOpen} toggleDay={toggleDay} />
          ))}
        </div>
        {/* the details take room only while a feature is picked (the names need the width) */}
        {selected && (
          <div className="timeline-detail">
            <button className="icon-btn tl-close" title="Close" onClick={() => setSel(null)}>×</button>
            <Detail t={selected.t} r={selected.r} name={featureName(selected.r, subjects)} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Group a project's features: the coach (and work on the project itself), then each part's sessions. */
function treeOf(t: ProjectTimeline, sessions: Map<string, Session>, subjects: Record<string, string>, query: string, openToo: boolean, everything: boolean): Tree {
  // features only (something was built or changed), unless the manager asks for every finished piece
  const rows = t.rows.filter((r) => ((everything ? r.kind === 'feature' : isFeature(r)) || (openToo && r.kind === 'open')) && matches(query, featureName(r, subjects), r.title, r.sub, r.hashes.join(' ')));
  const bySession = new Map<string, TimelineRow[]>();
  for (const r of rows) {
    const k = r.sessionId ?? '?';
    bySession.set(k, [...(bySession.get(k) ?? []), r]);
  }
  const nodeOf = (id: string): SessionNode => {
    const s = sessions.get(id);
    return { id, name: s ? displayTitle(s) : '(removed session)', ...(s && s.role !== 'player' ? { role: roleLabel(s) } : {}), rows: bySession.get(id) ?? [] };
  };
  const coach: SessionNode[] = [];
  const parts = new Map<string, PartNode>(t.lanes.slice(1).map((l) => [l.id, { id: l.id, name: l.name, sessions: [] }]));
  for (const id of bySession.keys()) {
    const s = sessions.get(id);
    const part = s ? parts.get(s.projectId) : undefined;
    if (part && s?.role === 'player') part.sessions.push(nodeOf(id));
    else coach.push(nodeOf(id));
  }
  // coordinators first among the project's own sessions; inside a part, the most recently active session first
  coach.sort((a, b) => Number(!!b.role) - Number(!!a.role) || b.rows.length - a.rows.length);
  for (const p of parts.values()) p.sessions.sort((a, b) => (b.rows[0]?.ts ?? 0) - (a.rows[0]?.ts ?? 0));
  return {
    id: t.projectId,
    name: t.name,
    color: t.color,
    coach,
    parts: [...parts.values()].filter((p) => p.sessions.length > 0),
    count: rows.length,
    done: rows.filter((r) => r.kind === 'feature').length,
    open: rows.filter((r) => r.kind === 'open').length
  };
}

const ROW_H = 30;
const DAY_H = 26;
const LANE_W = 18;

type VRow = { kind: 'day'; ts: number; key: string; open: boolean; count: number; names: string[] } | { kind: 'feature'; r: TimelineRow; lane: number };

/**
 * One project as a vertical timeline: newest at the top, a date line where the day changes, a thin vertical line per
 * session on the left (grouped by part, legend above) with a dot where that session finished a feature, and the
 * feature's name in full on the right — so what was added, when and by whom reads straight down the list.
 */
function ProjectLanes({ t, selected, onSelect, now, only, onToggle, onAll, log, dayOpen, toggleDay }: { t: Tree; selected: string | null; onSelect: (k: string) => void; now: number; only: string[]; onToggle: (id: string) => void; onAll: () => void; log?: Map<string, string>; dayOpen: Record<string, boolean>; toggleDay: (key: string, open: boolean) => void }): JSX.Element {
  const subjects = useGitSubjects((st) => st.subjects);
  const allLanes: { node: SessionNode; part?: string }[] = [...t.coach.map((n) => ({ node: n })), ...t.parts.flatMap((p) => p.sessions.map((n) => ({ node: n, part: p.name })))];
  // picked sessions of this project (a pick in another project leaves this one whole)
  const picked = allLanes.filter((l) => only.includes(l.node.id));
  const lanes = picked.length ? picked : allLanes;
  const laneOf = new Map(lanes.map((l, i) => [l.node.id, i]));
  const features = lanes.flatMap((l) => l.node.rows).sort((a, b) => b.ts - a.ts);
  // one line per day (its count, and the first names or the day's changelog when folded); features under open days
  const recent = new Set([0, 1, 2].map((k) => new Date(now - k * 86_400_000).toDateString()));
  const byDay = new Map<string, TimelineRow[]>();
  for (const r of features) {
    const d = new Date(r.ts).toDateString();
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const rows: VRow[] = [];
  for (const [d, list] of byDay) {
    const key = `${t.id}:${d}`;
    const open = dayOpen[key] ?? recent.has(d);
    rows.push({ kind: 'day', ts: list[0]!.ts, key, open, count: list.length, names: list.slice(0, 3).map((r) => featureName(r, subjects)) });
    if (open) for (const r of list) rows.push({ kind: 'feature', r, lane: laneOf.get(r.sessionId ?? '') ?? 0 });
  }
  const tops: number[] = [];
  let acc = 0;
  for (const row of rows) {
    tops.push(acc);
    acc += row.kind === 'day' ? DAY_H : ROW_H;
  }
  const graphW = 12 + lanes.length * LANE_W;
  const x = (lane: number): number => 12 + lane * LANE_W;
  const cy = (i: number): number => tops[i]! + ROW_H / 2;
  // each session's line runs from its newest to its oldest feature in view
  const span = new Map<number, [number, number]>();
  rows.forEach((row, i) => {
    if (row.kind !== 'feature') return;
    const cur = span.get(row.lane);
    span.set(row.lane, cur ? [Math.min(cur[0], cy(i)), Math.max(cur[1], cy(i))] : [cy(i), cy(i)]);
  });
  const shade = (lane: number): number => 0.45 + 0.55 * ((lanes.length - lane) / Math.max(1, lanes.length));
  return (
    <section className="tl-project" style={pcStyle(t.color)}>
      <div className="tl-head">
        <span className="pc-dot" />
        <b>{t.name}</b>
        <span className="muted">{t.done} features{t.open ? ` · ${t.open} in progress` : ''}</span>
        <span className="grow" />
        <DailySummarySwitch projectId={t.id} name={t.name} />
      </div>
      <div className="tl-legend">
        {picked.length > 0 && (
          <button className="tl-legend-item tl-all" onClick={onAll} title="Show every session again">All sessions</button>
        )}
        {allLanes.map((l) => {
          const on = only.includes(l.node.id);
          const i = lanes.indexOf(l);
          return (
            <button key={l.node.id} className={`tl-legend-item ${on ? 'on' : ''} ${picked.length && !on ? 'off' : ''}`} onClick={() => onToggle(l.node.id)} title={`${on ? 'Hide' : 'Show only'} ${l.part ? `${l.part} › ` : ''}${l.node.name}${picked.length ? '' : ' (click more to add)'}`}>
              <i style={{ opacity: i >= 0 ? shade(i) : 0.25 }} />
              {l.part && <span className="muted">{l.part} ›</span>} {l.node.role ? `${l.node.role} · ` : ''}{l.node.name} <span className="muted">{l.node.rows.length}</span>
            </button>
          );
        })}
      </div>
      <div className="tl-vrows" style={{ height: acc }}>
        <svg className="tl-vgraph" width={graphW} height={acc} aria-hidden="true">
          {[...span.entries()].map(([lane, [y1, y2]]) => (
            <line key={lane} x1={x(lane)} y1={y1} x2={x(lane)} y2={y2} className="tl-vline" style={{ opacity: shade(lane) }} />
          ))}
          {rows.map((row, i) =>
            row.kind === 'feature' ? (
              <circle key={row.r.key} cx={x(row.lane)} cy={cy(i)} r={selected === row.r.key ? 6.5 : 5} className={`tl-vdot ${row.r.kind} ${selected === row.r.key ? 'on' : ''}`} style={{ opacity: row.r.kind === 'open' ? 1 : shade(row.lane) }} />
            ) : null
          )}
        </svg>
        {rows.map((row, i) =>
          row.kind === 'day' ? (
            <div key={row.key} className={`tl-day ${row.open ? 'open' : ''}`} style={{ top: tops[i], height: DAY_H, paddingLeft: graphW + 8 }} onClick={() => toggleDay(row.key, row.open)} title={log?.get(new Date(row.ts).toDateString()) ?? row.names.join('\n')}>
              <span className="caret">{row.open ? '▾' : '▸'}</span>
              <b>{dayTime(row.ts, now).replace(/ \d\d:\d\d$/, '')}</b>
              <span className="muted">{row.count} feature{row.count > 1 ? 's' : ''}</span>
              {(() => {
                const summary = log?.get(new Date(row.ts).toDateString());
                if (summary) return <span className="tl-day-log">{summary.split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).join(' · ')}</span>;
                return !row.open ? <span className="tl-day-names">{row.names.join(' · ')}{row.count > 3 ? ' …' : ''}</span> : null;
              })()}
            </div>
          ) : (
            <div
              key={row.r.key}
              className={`tl-vrow ${row.r.kind} ${selected === row.r.key ? 'on' : ''}`}
              style={{ top: tops[i], height: ROW_H, paddingLeft: graphW + 8 }}
              onClick={() => onSelect(row.r.key)}
              title={`${row.r.title}\n${formatDateTime(row.r.ts)}`}
            >
              <span className="tl-vtime muted">{new Date(row.r.ts).toTimeString().slice(0, 5)}</span>
              <span className="tl-name">{featureName(row.r, subjects)}</span>
              {row.r.hashes.slice(0, 1).map((h) => <span key={h} className="tl-hash">{h.slice(0, 7)}</span>)}
              <span className="tl-who muted">{lanes[row.lane]?.part ? `${lanes[row.lane]!.part} › ` : ''}{lanes[row.lane]?.node.name}</span>
            </div>
          )
        )}
      </div>
    </section>
  );
}

/** The selected feature: what was added, how it ended (the final report, formatted), commits, and where to go next. */
function Detail({ t, r, name }: { t: ProjectTimeline; r: TimelineRow; name: string }): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const subjects = useGitSubjects((st) => st.subjects);
  const openFlow = useFlow((s) => s.open);
  const s = r.sessionId ? sessions.get(r.sessionId) : undefined;
  const asked = bodyOf(r.node.item);
  const said = r.report ? bodyOf(r.report) : '';
  const html = useMemo(() => (said ? renderMarkdown(said) : ''), [said]);
  const askedHtml = useMemo(() => renderMarkdown(asked), [asked]);
  return (
    <div className="tl-detail" data-cwd={s?.cwd}>
      <div className="tl-detail-head">
        <span className={`tl-kind ${r.kind}`}>{r.kind === 'open' ? 'In progress' : 'Feature'}</span>
        <span className="muted">{t.name}{r.lane > 0 ? ` › ${t.lanes[r.lane]?.name}` : ''}</span>
        <span className="grow" />
        <span className="muted" title={formatDateTime(r.ts)}>{dayTime(r.ts)}</span>
      </div>
      <h3 className="tl-detail-title">{name}</h3>
      <div className="tl-detail-meta">
        {s && <span>by <b>{displayTitle(s)}</b></span>}
        {r.reports > 1 && <span className="muted">{r.reports} reports</span>}
      </div>
      {r.hashes.length > 0 && (
        <div className="tl-commits">
          {r.hashes.map((h) => (
            <div key={h} className="tl-commit">
              <button className="tl-hash" title="Copy the commit hash" onClick={() => copyPath(h, 'Commit')}>{h}</button>
              <span>{subjects[h] ?? ''}</span>
            </div>
          ))}
        </div>
      )}
      <div className="tl-actions">
        {s && <button className="btn sm" onClick={() => { useStore.getState().setViewMode('board'); selectAndReveal(s.id); }}>Open session</button>}
        <button className="btn sm ghost" onClick={() => openFlow(r.order)}>Flow</button>
      </div>
      {said && (
        <>
          <div className="tl-section">How it ended</div>
          <div className="md chat-md tl-md" dangerouslySetInnerHTML={{ __html: html }} />
        </>
      )}
      <div className="tl-section">What was asked</div>
      <div className="md chat-md tl-md" dangerouslySetInnerHTML={{ __html: askedHtml }} />
    </div>
  );
}

/**
 * The daily changelog for a project: a routine (every day at 18:00) asks its coach for the features finished that day;
 * the reply shows on the day's line. Off by default — it costs one short coordinator turn a day.
 */
function DailySummarySwitch({ projectId, name }: { projectId: string; name: string }): JSX.Element | null {
  const routines = useStore((s) => s.routines);
  if (!projectId) return null;
  const mine = routines.find((r) => r.text.startsWith(CHANGELOG_TAG) && r.target.kind === 'project' && r.target.projectId === projectId);
  return (
    <button
      className={`btn sm ghost tl-summary ${mine?.enabled ? 'on' : ''}`}
      title={mine?.enabled ? `Daily summary on: every day at ${mine.dailyAt}, the coach lists the day's features (shown on the date line). Click to turn off.` : 'Daily summary: every day at 18:00, the coach lists the features finished that day (one short turn). Click to turn on.'}
      onClick={() => {
        if (mine) send({ type: 'routine.delete', id: mine.id });
        else send({ type: 'routine.save', routine: { name: `Daily changelog · ${name}`, target: { kind: 'project', projectId }, text: CHANGELOG_ORDER, dailyAt: '18:00', enabled: true } });
      }}
    >
      {mine?.enabled ? '✓ Daily summary' : 'Daily summary'}
    </button>
  );
}
