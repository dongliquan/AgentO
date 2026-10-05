import { unreadCount, useStore } from '@/store';
import { send } from '@/client';
import { gotoNextWaiting } from '@/commands';
import { AGENT_LABELS } from '@/lib/format';
import { AgentIcon } from './AgentIcon';
import { useNow } from '@/lib/hooks';
import { useClosedSessionIds } from '@/lib/closed';
import { kbd } from '@/lib/keys';

/** "claude-opus-5-5" → "Opus 5.5" */
function shortModel(id: string | undefined): string | null {
  if (!id) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!m) return id.replace(/^claude-/, '');
  const fam = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return `${fam} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

/** "2h 05m" / "12m" until the given time; null when past or unknown. */
function countdown(to: number | undefined, now: number): string | null {
  if (!to) return null;
  const mins = Math.round((to - now) / 60000);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function StatusBar(): JSX.Element {
  const connected = useStore((s) => s.connected);
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const selectedId = useStore((s) => s.selectedId);
  const usage = useStore((s) => s.usage);
  const agents = useStore((s) => s.agents);
  const unread = useStore(unreadCount);
  const zoom = useStore((s) => s.zoom);
  const setActivity = useStore((s) => s.setActivity);
  const now = useNow(30_000);

  // a closed project's sessions are not counted
  const closed = useClosedSessionIds();
  const list = [...sessions.values()].filter((s) => !closed.has(s.id));
  const count = (st: string): number => list.filter((s) => s.status === st).length;
  const waiting = count('waiting');
  const sel = selectedId ? sessions.get(selectedId) : undefined;
  const own = sel ? projects.find((p) => p.id === sel.projectId) : undefined;
  const root = own?.parentId ? projects.find((p) => p.id === own.parentId) : own;
  const project = root && !root.closed ? root : projects.find((p) => !p.parentId && !p.closed);
  // Only agents that have at least one session (i.e. actually used).
  const usedAgents = agents.filter((a) => list.some((s) => s.agent === a.kind));

  return (
    <div className="statusbar">
      <span className="seg" title={connected ? 'Connected to daemon' : 'Daemon disconnected — reconnecting'}>
        <span className={`dot ${connected ? 'on' : 'off'}`} />
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      <span className="seg">{project?.name ?? '-'}</span>
      <span className="seg" title="Working / Waiting for input / Done / Hibernated">
        <span style={{ color: 'var(--ok)' }}>▶ {count('working') + count('starting')}</span>
        <span style={{ color: 'var(--warn)' }}>? {waiting}</span>
        <span>✓ {count('done')}</span>
        <span>◌ {count('hibernated')}</span>
        {count('error') > 0 && <span style={{ color: 'var(--err)' }}>! {count('error')}</span>}
      </span>
      {waiting > 0 && (
        <span className="seg click" style={{ color: 'var(--warn)' }} onClick={gotoNextWaiting}>
          {kbd('Go to waiting session (Ctrl+Shift+W)')}
        </span>
      )}
      <span className="spacer" />
      {usedAgents.map((a) => {
        const u = usage.find((x) => x.agent === a.kind);
        const running = list.filter((s) => s.agent === a.kind && (s.status === 'working' || s.status === 'waiting' || s.status === 'starting')).length;
        const pct = u?.ratio !== undefined ? Math.round(Math.min(1, Math.max(0, u.ratio)) * 100) : null;
        const lvl = u?.ratio === undefined ? '' : u.ratio >= 0.9 ? 'err' : u.ratio >= 0.7 ? 'warn' : '';
        const reset = countdown(u?.resetsAt, now);
        const name = a.label || AGENT_LABELS[a.kind];
        const model = shortModel(u?.model);
        const tip = [
          name,
          u?.model ? `Model ${u.model}` : null,
          `${running} active session${running === 1 ? '' : 's'}`,
          u?.tokens !== undefined ? `${u.tokens.toLocaleString()} tokens in the current 5-hour window (input + output + cache writes)` : u && u.label !== '—' ? `Usage ${u.label}` : 'Usage unavailable',
          u?.resetsAt ? `Window resets ${new Date(u.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null
        ].filter(Boolean).join('\n');
        return (
          <span className="seg agent-seg" key={a.kind} title={tip}>
            <AgentIcon kind={a.kind} color={a.color} />
            <span>{name}</span>
            {running > 0 && <span className="agent-count">{running}</span>}
            {model && <span className="agent-model">{model}</span>}
            {pct !== null ? (
              <>
                <span className={`mini-bar ${lvl}`}>
                  <div style={{ width: `${pct}%` }} />
                </span>
                <span>{pct}%</span>
              </>
            ) : (
              <span>{u?.label ?? '—'}</span>
            )}
            {reset && <span className="muted">⟳ {reset}</span>}
            {u?.warning && <span style={{ color: 'var(--warn)' }}>⚠ {u.warning}</span>}
          </span>
        );
      })}
      <span className="seg click" title="Refresh usage" onClick={() => send({ type: 'usage.refresh' })}>↻</span>
      <span className="seg click" onClick={() => setActivity('inbox')}>Inbox {unread}</span>
      <span className="seg">{Math.round(zoom * 100)}%</span>
    </div>
  );
}
