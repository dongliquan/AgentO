import { useEffect, useMemo, useState } from 'react';
import type { UsageBucket, UsageReport, UsageSessionInfo } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { projectColor } from '@/lib/format';

type Range = 1 | 7 | 30;
type GroupBy = 'project' | 'session' | 'role' | 'model' | 'time';

const TEAM_COLOR = '#64748b';
const OUTSIDE_COLOR = '#94a3b8';
const HOUR = 3600_000;

/** 1234 → 1.2K, 3_400_000 → 3.4M */
export function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}
const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const total = (b: { input: number; output: number; cacheWrite: number; cacheRead: number }): number => b.input + b.output + b.cacheWrite + b.cacheRead;
const ROLE_NAME: Record<string, string> = { head: 'Coach', coach: 'Part coach', player: 'Player', outside: 'Outside AgentO' };
const shortModel = (m: string): string => m.replace(/^claude-/, '').replace(/-\d{8}$/, '') || '?';

interface Agg {
  name: string;
  color?: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  turns: number;
}
const empty = (name: string, color?: string): Agg => ({ name, ...(color ? { color } : {}), input: 0, output: 0, cacheWrite: 0, cacheRead: 0, turns: 0 });
function add(a: Agg, b: UsageBucket): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
  a.turns += b.turns;
}

/** Manager › Usage: tokens spent by every Claude session, by project, time, session, role and model — and where to save. */
export function UsageDialog(): JSX.Element | null {
  const open = useStore((s) => s.usageOpen);
  const close = useStore((s) => s.closeUsage);
  const report = useStore((s) => s.usageReport);
  const projects = useStore((s) => s.projects);
  const [days, setDays] = useState<Range>(7);
  const [outside, setOutside] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);

  const load = (): void => {
    setLoading(true);
    send({ type: 'usage.report', days, outside });
  };
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, days, outside]);
  useEffect(() => setLoading(false), [report]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const model = useMemo(() => (report ? build(report, projects, days) : null), [report, projects, days]);
  if (!open) return null;

  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog usage-dialog" role="dialog" aria-label="Token usage">
        <div className="usage-head">
          <h3>Token Usage</h3>
          <div className="seg">
            {([1, 7, 30] as Range[]).map((d) => (
              <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
                {d === 1 ? '24 h' : `${d} days`}
              </button>
            ))}
          </div>
          <label className="usage-outside" title="Also count Claude Code sessions outside AgentO (VS Code, terminals)">
            <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} />
            Include outside AgentO
          </label>
          <span className="grow" />
          <button className="btn sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        <button className="icon-btn dialog-x" onClick={close} title="Close (Esc)" aria-label="Close">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {!model ? (
          <div className="muted">Reading the transcripts…</div>
        ) : model.all.turns === 0 ? (
          <div className="muted">No Claude usage in this range.</div>
        ) : (
          <div className="usage-body">
            <div className="usage-tiles">
              <Tile label="Total tokens" value={fmt(total(model.all))} sub={`${fmt(model.all.turns)} API calls`} />
              <Tile label="Context re-read (cache read)" value={pct(model.all.cacheRead, total(model.all))} sub={fmt(model.all.cacheRead)} />
              <Tile label="New context (cache write + input)" value={fmt(model.all.cacheWrite + model.all.input)} sub={pct(model.all.cacheWrite + model.all.input, total(model.all))} />
              <Tile label="Output" value={fmt(model.all.output)} sub={pct(model.all.output, total(model.all))} />
              <Tile label="Avg context per call" value={fmt((model.all.input + model.all.cacheWrite + model.all.cacheRead) / Math.max(1, model.all.turns))} sub="tokens read each call" />
            </div>

            <section>
              <h4>Over time · by project {days === 1 ? '(per hour)' : '(per day)'}</h4>
              <div className="usage-legend">
                {model.groups.map((g) => (
                  <span key={g.name}>
                    <i style={{ background: g.color }} />
                    {g.name}
                  </span>
                ))}
              </div>
              <TimeChart model={model} hover={hover} setHover={setHover} />
            </section>

            <section>
              <div className="usage-table-head">
                <h4>Breakdown</h4>
                <div className="seg">
                  {(['project', 'session', 'role', 'model', 'time'] as GroupBy[]).map((g) => (
                    <button key={g} className={groupBy === g ? 'on' : ''} onClick={() => setGroupBy(g)}>
                      {g === 'time' ? (days === 1 ? 'Hour' : 'Day') : g[0]!.toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <Table rows={model.tables[groupBy]} all={model.all} />
            </section>

            <section>
              <h4>Ways to save</h4>
              <ul className="usage-tips">
                {model.tips.map((t, i) => (
                  <li key={i}>
                    <b>{t.title}</b> {t.body}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h4>Team traffic · what sessions send each other</h4>
              <Traffic sessions={model.sessions} all={model.all} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="usage-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/* ---------- model ---------- */

interface Built {
  all: Agg;
  groups: { name: string; color: string }[];
  periods: { start: number; label: string; byGroup: Map<string, Agg> }[];
  tables: Record<GroupBy, Agg[]>;
  sessions: (UsageSessionInfo & { project: string; agg: Agg; models: string[] })[];
  tips: { title: string; body: string }[];
}

function build(r: UsageReport, projects: { id: string; name: string; parentId?: string; color?: string }[], days: number): Built {
  const info = new Map(r.sessions.map((s) => [s.key, s]));
  const rootOf = (id: string): { id: string; name: string; parentId?: string; color?: string } | undefined => {
    const p = projects.find((x) => x.id === id);
    return p?.parentId ? projects.find((x) => x.id === p.parentId) : p;
  };
  const groupOf = (key: string): { name: string; color: string } => {
    if (key.startsWith('outside:')) return { name: 'Outside AgentO', color: OUTSIDE_COLOR };
    const s = info.get(key);
    const root = s?.projectId ? rootOf(s.projectId) : undefined;
    if (!root) return { name: 'Team', color: TEAM_COLOR };
    return { name: root.name, color: projectColor(root.id, projects) };
  };
  const all = empty('All');
  const byProject = new Map<string, Agg>();
  const bySession = new Map<string, Agg>();
  const byRole = new Map<string, Agg>();
  const byModel = new Map<string, Agg>();
  const sessionModels = new Map<string, Set<string>>();
  // periods: every hour of the last 24 h, or every day of the range (gaps stay visible)
  const step = days === 1 ? HOUR : 24 * HOUR;
  const startOf = (t: number): number => {
    if (days === 1) return Math.floor(t / HOUR) * HOUR;
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const first = startOf(r.since + (days === 1 ? HOUR : 0));
  const periods: Built['periods'] = [];
  for (let t = first; t <= r.generatedAt; t = days === 1 ? t + step : startOf(t + step + 2 * HOUR)) {
    const d = new Date(t);
    periods.push({ start: t, label: days === 1 ? `${d.getHours()}:00` : `${d.getMonth() + 1}/${d.getDate()}`, byGroup: new Map() });
  }
  const periodIndex = (t: number): number => {
    const s = startOf(t);
    let i = periods.findIndex((p) => p.start === s);
    if (i < 0) i = s < periods[0]!.start ? 0 : periods.length - 1;
    return i;
  };
  for (const b of r.buckets) {
    const g = groupOf(b.key);
    add(all, b);
    const get = (m: Map<string, Agg>, k: string, name = k, color?: string): Agg => {
      let a = m.get(k);
      if (!a) m.set(k, (a = empty(name, color)));
      return a;
    };
    add(get(byProject, g.name, g.name, g.color), b);
    const s = info.get(b.key);
    add(get(bySession, b.key, s ? `${s.title}${s.role === 'outside' ? '' : ` · ${g.name}`}` : b.key, g.color), b);
    const role = s?.role === 'head' && !s.projectId ? 'Head Coach' : ROLE_NAME[s?.role ?? 'outside'] ?? s?.role ?? '?';
    add(get(byRole, role), b);
    add(get(byModel, shortModel(b.model)), b);
    (sessionModels.get(b.key) ?? sessionModels.set(b.key, new Set()).get(b.key)!).add(shortModel(b.model));
    const p = periods[periodIndex(b.hour)]!;
    add(get(p.byGroup, g.name, g.name, g.color), b);
  }
  const sorted = (m: Map<string, Agg>): Agg[] => [...m.values()].sort((a, b) => total(b) - total(a));
  // series order: projects by size (stable for this report), Team and Outside last
  const groups = sorted(byProject)
    .sort((a, b) => Number(a.name === 'Outside AgentO') - Number(b.name === 'Outside AgentO') || Number(a.name === 'Team') - Number(b.name === 'Team'))
    .map((a) => ({ name: a.name, color: a.color ?? TEAM_COLOR }));
  const timeRows = periods.map((p) => {
    const a = empty(days === 1 ? `${new Date(p.start).getMonth() + 1}/${new Date(p.start).getDate()} ${p.label}` : p.label);
    for (const g of p.byGroup.values()) {
      a.input += g.input;
      a.output += g.output;
      a.cacheWrite += g.cacheWrite;
      a.cacheRead += g.cacheRead;
      a.turns += g.turns;
    }
    return a;
  }).filter((a) => a.turns > 0).reverse();
  const sessions = r.sessions
    .map((s) => ({ ...s, project: groupOf(s.key).name, agg: bySession.get(s.key) ?? empty(s.title), models: [...(sessionModels.get(s.key) ?? [])] }))
    .sort((a, b) => total(b.agg) - total(a.agg));
  return {
    all,
    groups,
    periods,
    tables: { project: sorted(byProject), session: sorted(bySession), role: sorted(byRole), model: sorted(byModel), time: timeRows },
    sessions,
    tips: tips(all, sessions)
  };
}

/** Where the tokens go and what would cut them — computed from this report. */
function tips(all: Agg, sessions: Built['sessions']): Built['tips'] {
  const out: Built['tips'] = [];
  const t = total(all);
  const team = sessions.filter((s) => s.role !== 'outside');
  out.push({
    title: `${pct(all.cacheRead, t)} of the tokens are context read again.`,
    body: 'Every call re-reads the whole conversation so far (system prompt, tools, files read, replies). Fewer calls on a shorter context is what saves — not shorter messages.'
  });
  const big = team.filter((s) => s.maxContext >= 150_000).slice(0, 4);
  if (big.length)
    out.push({
      title: 'Long-lived contexts:',
      body: `${big.map((s) => `${s.title} (peak ${fmt(s.maxContext)})`).join(', ')}. Start these fresh (/clear) or /compact once an order is reported — the team log and files keep the state.`
    });
  const leads = team.filter((s) => s.role === 'head' || s.role === 'coach');
  const doing = leads
    .map((s) => {
      const work = s.tools.filter((x) => /^(Edit|Write|MultiEdit|NotebookEdit|Bash)$/.test(x.tool));
      const calls = work.reduce((a, x) => a + x.calls, 0);
      return { s, calls, list: work.map((x) => `${x.tool}×${x.calls}`).join(' ') };
    })
    .filter((x) => x.calls >= 10)
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 4);
  if (doing.length)
    out.push({
      title: 'Coordinators doing the work:',
      body: `${doing.map((x) => `${x.s.title} (${x.list})`).join(', ')}. Every command's output stays in a coach's context and is re-read on each later call; leave running and editing to players.`
    });
  const readers = leads
    .map((s) => ({ s, bytes: s.tools.filter((x) => x.tool === 'Read').reduce((a, x) => a + x.bytes, 0) }))
    .filter((x) => x.bytes >= 200_000)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 4);
  if (readers.length)
    out.push({
      title: 'Large files read by coaches:',
      body: `${readers.map((x) => `${x.s.title} (${fmt(x.bytes)} chars)`).join(', ')}. Ask a player for a summary instead of reading whole files (images and PDFs are the heaviest).`
    });
  const top = leads.filter((s) => s.models.some((m) => /fable|opus|mythos/.test(m)));
  if (top.length)
    out.push({
      title: 'Coordination on the top model:',
      body: `${top.length} coach session(s) run on ${[...new Set(top.flatMap((s) => s.models))].join(', ')}. Splitting orders and reviewing reports runs well on a lighter model (e.g. Sonnet) at a fraction of the usage; keep the strongest model for players.`
    });
  const trafficChars = team.reduce((a, s) => a + s.teamMessageBytes + s.tools.filter((x) => x.tool.startsWith('mcp__agento__')).reduce((b, x) => b + x.bytes, 0), 0);
  out.push({
    title: `Messages between sessions are small: ~${fmt(trafficChars / 3)} tokens (${pct(trafficChars / 3, t)}).`,
    body: 'Orders, reports and AgentO tool results barely register; read_session is the largest of them. Trimming them further would not change the total much.'
  });
  return out;
}

/* ---------- chart ---------- */

function TimeChart({ model, hover, setHover }: { model: Built; hover: { x: number; i: number } | null; setHover: (h: { x: number; i: number } | null) => void }): JSX.Element {
  const W = 840;
  const H = 180;
  const padL = 44;
  const padB = 20;
  const padT = 6;
  const n = model.periods.length;
  const slot = (W - padL) / Math.max(1, n);
  const barW = Math.max(3, Math.min(28, slot - 4));
  const max = Math.max(1, ...model.periods.map((p) => [...p.byGroup.values()].reduce((a, g) => a + total(g), 0)));
  const y = (v: number): number => ((H - padB - padT) * v) / max;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(n / 12));
  const hp = hover ? model.periods[hover.i] : undefined;
  return (
    <div className="usage-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Tokens over time, stacked by project">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W} y1={H - padB - y(t)} y2={H - padB - y(t)} className="grid" />
            <text x={padL - 6} y={H - padB - y(t) + 3} textAnchor="end" className="axis">{fmt(t)}</text>
          </g>
        ))}
        {model.periods.map((p, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          let acc = 0;
          return (
            <g key={p.start}>
              {model.groups.map((g) => {
                const a = p.byGroup.get(g.name);
                if (!a) return null;
                const h = y(total(a));
                const rect = <rect key={g.name} x={x} y={H - padB - acc - h} width={barW} height={Math.max(0.5, h)} fill={g.color} className="seg-rect" />;
                acc += h;
                return rect;
              })}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 5} textAnchor="middle" className="axis">{p.label}</text>
              )}
              <rect
                x={padL + i * slot}
                y={padT}
                width={slot}
                height={H - padB - padT}
                className={`hit ${hover?.i === i ? 'on' : ''}`}
                onMouseEnter={() => setHover({ x: ((padL + i * slot + slot / 2) / W) * 100, i })}
              />
            </g>
          );
        })}
      </svg>
      {hp && (
        // near the edges the tooltip opens inward, so it is never cut off by the dialog
        <div className={`usage-tip ${hover!.x > 70 ? 'to-left' : hover!.x < 30 ? 'to-right' : ''}`} style={{ left: `${hover!.x}%` }}>
          <div className="t">{hp.label}</div>
          {[...hp.byGroup.values()].length === 0 ? (
            <div className="muted">No usage</div>
          ) : (
            [...hp.byGroup.values()]
              .sort((a, b) => total(b) - total(a))
              .map((g) => (
                <div key={g.name} className="r">
                  <i style={{ background: g.color }} />
                  <span>{g.name}</span>
                  <b>{fmt(total(g))}</b>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}

function Table({ rows, all }: { rows: Agg[]; all: Agg }): JSX.Element {
  const t = total(all);
  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="num">Total</th>
            <th>Share</th>
            <th className="num" title="Context read again on each call">Cache read</th>
            <th className="num" title="New context written to the cache">Cache write</th>
            <th className="num">Output</th>
            <th className="num">Input</th>
            <th className="num">Calls</th>
            <th className="num" title="Tokens read per call on average">Avg ctx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="name">
                {r.color && <i style={{ background: r.color }} />}
                <span className="ellipsis" title={r.name}>{r.name}</span>
              </td>
              <td className="num"><b>{fmt(total(r))}</b></td>
              <td className="share">
                <span className="bar"><span style={{ width: `${(total(r) / Math.max(1, t)) * 100}%` }} /></span>
                <span className="muted">{pct(total(r), t)}</span>
              </td>
              <td className="num">{fmt(r.cacheRead)}</td>
              <td className="num">{fmt(r.cacheWrite)}</td>
              <td className="num">{fmt(r.output)}</td>
              <td className="num">{fmt(r.input)}</td>
              <td className="num">{fmt(r.turns)}</td>
              <td className="num">{fmt((r.input + r.cacheWrite + r.cacheRead) / Math.max(1, r.turns))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Traffic({ sessions, all }: { sessions: Built['sessions']; all: Agg }): JSX.Element {
  const rows = sessions
    .filter((s) => s.role !== 'outside')
    .map((s) => {
      const agento = s.tools.filter((x) => x.tool.startsWith('mcp__agento__'));
      const toolChars = agento.reduce((a, x) => a + x.bytes, 0);
      const top = agento.slice(0, 3).map((x) => `${x.tool.replace('mcp__agento__', '')} ×${x.calls}`).join(', ');
      return { s, toolChars, top, chars: toolChars + s.teamMessageBytes };
    })
    .filter((r) => r.chars > 0)
    .sort((a, b) => b.chars - a.chars);
  const t = total(all);
  if (rows.length === 0) return <div className="muted">No team messages in this range.</div>;
  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th>Session</th>
            <th className="num" title="Orders and [AgentO] notes it received">Msgs in</th>
            <th className="num">Msg chars</th>
            <th className="num" title="Size of AgentO tool results it read">Tool result chars</th>
            <th>Top AgentO tools</th>
            <th className="num" title="≈ chars / 3, against all tokens in the range">≈ tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, toolChars, top, chars }) => (
            <tr key={s.key}>
              <td className="name"><span className="ellipsis" title={`${s.title} · ${s.project}`}>{s.title}</span></td>
              <td className="num">{s.teamMessages}</td>
              <td className="num">{fmt(s.teamMessageBytes)}</td>
              <td className="num">{fmt(toolChars)}</td>
              <td className="muted ellipsis">{top || '—'}</td>
              <td className="num">{fmt(chars / 3)} <span className="muted">({pct(chars / 3, t)})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
