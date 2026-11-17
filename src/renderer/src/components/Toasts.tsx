import { useState } from 'react';
import { NeedsYouAlerts } from './NeedsYou';
import { openNotification, useNotifyPrefs, useToasts, type NotifyPrefs } from '@/lib/notify';

/** Reports and finished orders while the window is in front (in the background they are OS notifications). */
export function Toasts(): JSX.Element {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {/* what waits for the manager stays on top until it is clicked */}
      <NeedsYouAlerts />
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
  { id: 'off', label: 'None' }
];

/** Status bar 🔔: what raises a notification. */
export function NotifyMenu(): JSX.Element {
  const prefs = useNotifyPrefs();
  const [open, setOpen] = useState(false);
  const off = prefs.sessions === 'off';
  return (
    <span className="seg click notify-seg" title="Notifications" onClick={() => setOpen((v) => !v)}>
      {off ? '🔕' : '🔔'}
      {open && (
        <>
          <div className="notify-scrim" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="notify-menu" onClick={(e) => e.stopPropagation()}>
            <div className="notify-head">Notify me about</div>
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
