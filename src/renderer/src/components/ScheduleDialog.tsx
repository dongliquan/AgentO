import { useEffect, useState } from 'react';
import type { Routine } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { formatDateTime } from '@/lib/format';

type Mode = 'every' | 'daily' | 'once';

/** "every 30 min" / "daily 09:00" / "once 09:00" */
export function scheduleText(r: Pick<Routine, 'everyMinutes' | 'dailyAt' | 'once'>): string {
  if (r.dailyAt) return `${r.once ? 'once' : 'daily'} ${r.dailyAt}`;
  const n = r.everyMinutes ?? 0;
  return n % 60 === 0 && n >= 60 ? `every ${n / 60} h` : `every ${n} min`;
}

/**
 * The scheduled messages of one session: the daemon types each into the session on its schedule (a stopped session is
 * woken, a busy one skips that run), with no window open. A form adds one; each row can be paused, sent now or removed.
 */
export function ScheduleDialog(): JSX.Element | null {
  const sessionId = useStore((s) => s.scheduleFor);
  const session = useStore((s) => (s.scheduleFor ? s.sessions.get(s.scheduleFor) : undefined));
  const routines = useStore((s) => s.routines);
  const close = useStore((s) => s.closeSchedule);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('daily');
  const [minutes, setMinutes] = useState(60);
  const [at, setAt] = useState('09:00');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionId, close]);

  if (!sessionId || !session) return null;
  const mine = routines.filter((r) => r.target.sessionId === sessionId);

  const add = (): void => {
    if (!text.trim()) return setError('Write the message to send.');
    if (mode === 'every' && !(minutes >= 1)) return setError('Every how many minutes?');
    if (mode !== 'every' && !/^\d{1,2}:\d{2}$/.test(at)) return setError('The time looks like 09:00.');
    setError('');
    send({
      type: 'routine.save',
      routine: {
        name: text.trim().slice(0, 40),
        target: { sessionId },
        text: text.trim(),
        enabled: true,
        ...(mode === 'every' ? { everyMinutes: Math.floor(minutes) } : { dailyAt: at }),
        ...(mode === 'once' ? { once: true } : {})
      }
    });
    setText('');
  };

  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog schedule-dialog">
        <button className="icon-btn dialog-x" onClick={close} title="Close (Esc)" aria-label="Close">×</button>
        <h3>Scheduled messages · {session.title}</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Typed into this session on schedule, even with no window open. A stopped session is started for it; a busy one skips that run. <code>{'{run}'}</code> in the text is the run number.
        </div>
        {mine.length === 0 ? (
          <div className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>Nothing is scheduled for this session.</div>
        ) : (
          <div className="schedule-list">
            {mine.map((r) => (
              <div key={r.id} className={`schedule-row ${r.enabled ? '' : 'paused'}`}>
                <div className="schedule-main">
                  <div className="schedule-text" title={r.text}>{r.text}</div>
                  <div className="muted schedule-meta">
                    {scheduleText(r)} · {r.enabled ? `next ${formatDateTime(r.nextAt)}` : 'paused'} · sent {r.runs}×{r.lastRunAt ? `, last ${formatDateTime(r.lastRunAt)}` : ''}
                  </div>
                </div>
                <button className="btn sm" title="Send it now" onClick={() => send({ type: 'routine.run', id: r.id })}>Send now</button>
                <button
                  className="btn sm"
                  onClick={() =>
                    send({
                      type: 'routine.save',
                      routine: {
                        id: r.id,
                        name: r.name,
                        target: r.target,
                        text: r.text,
                        enabled: !r.enabled,
                        ...(r.dailyAt ? { dailyAt: r.dailyAt } : { everyMinutes: r.everyMinutes }),
                        ...(r.once ? { once: true } : {})
                      }
                    })
                  }
                >
                  {r.enabled ? 'Pause' : 'Resume'}
                </button>
                <button className="icon-btn" title="Remove" onClick={() => send({ type: 'routine.delete', id: r.id })}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="field">
          <label>New message</label>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Summarize today's changes and what is left for tomorrow." />
        </div>
        <div className="field">
          <label>When</label>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="daily">Every day at</option>
              <option value="every">Every N minutes</option>
              <option value="once">Once, at the next</option>
            </select>
            {mode === 'every' ? (
              <input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ width: 90 }} />
            ) : (
              <input type="time" value={at} onChange={(e) => setAt(e.target.value)} />
            )}
          </div>
        </div>
        {error && <div className="error-text" style={{ fontSize: 12 }}>{error}</div>}
        <div className="actions">
          <button className="btn" onClick={close}>Close</button>
          <button className="btn primary" onClick={add}>Schedule</button>
        </div>
      </div>
    </div>
  );
}
