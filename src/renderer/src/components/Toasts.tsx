import { useState } from 'react';
import { openNotification, useNotifyPrefs, useToasts, type NotifyPrefs } from '@/lib/notify';

/** Reports and finished orders while the window is in front (in the background they are OS notifications). */
export function Toasts(): JSX.Element | null {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          onClick={() => {
            dismiss(t.id);
            openNotification(t);
          }}
        >
          <div className="toast-title">{t.title}</div>
          {t.body && <div className="toast-body">{t.body}</div>}
          <button
            className="toast-x"
            title="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

const SESSION_OPTIONS: { id: NotifyPrefs['sessions']; label: string }[] = [
  { id: 'all', label: 'Every session' },
  { id: 'leads', label: 'Head Coach and coaches' },
  { id: 'off', label: 'None' }
];

/** Status bar 🔔: what raises a notification. */
export function NotifyMenu(): JSX.Element {
  const prefs = useNotifyPrefs();
  const [open, setOpen] = useState(false);
  const off = !prefs.reports && !prefs.orders && !prefs.pieces && prefs.sessions === 'off';
  return (
    <span className="seg click notify-seg" title="Notifications" onClick={() => setOpen((v) => !v)}>
      {off ? '🔕' : '🔔'}
      {open && (
        <>
          <div className="notify-scrim" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="notify-menu" onClick={(e) => e.stopPropagation()}>
            <div className="notify-head">Notify me about</div>
            <label className="notify-row">
              <input type="checkbox" checked={prefs.reports} onChange={(e) => prefs.set({ reports: e.target.checked })} />
              Reports to me
            </label>
            <label className="notify-row">
              <input type="checkbox" checked={prefs.orders} onChange={(e) => prefs.set({ orders: e.target.checked })} />
              Orders done (every piece reported)
            </label>
            <label className="notify-row">
              <input type="checkbox" checked={prefs.pieces} onChange={(e) => prefs.set({ pieces: e.target.checked })} />
              Pieces of work finished or stopped
            </label>
            <div className="notify-head">Session waiting / finished / error</div>
            {SESSION_OPTIONS.map((o) => (
              <label key={o.id} className="notify-row">
                <input type="radio" name="notify-sessions" checked={prefs.sessions === o.id} onChange={() => prefs.set({ sessions: o.id })} />
                {o.label}
              </label>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
