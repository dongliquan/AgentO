import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { useEscape } from '@/lib/hooks';
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme';
import { setNick, useNick } from '@/lib/nick';

/** File › Settings: what can be set today — what you are called, light / dark, and the way to the agent connections. */
export function SettingsDialog(): JSX.Element | null {
  const open = useStore((s) => s.settingsOpen);
  const close = useStore((s) => s.closeSettings);
  const nick = useNick();
  const [name, setName] = useState(nick);
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  useEffect(() => {
    if (open) {
      setName(nick);
      setTheme(getThemePref());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEscape(open, close);
  if (!open) return null;
  const save = (): void => {
    if (name.trim() !== nick) setNick(name);
  };
  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog settings-dialog">
        <button className="icon-btn dialog-x" onClick={close} title="Close (Esc)" aria-label="Close">×</button>
        <h3>Settings</h3>
        <label className="settings-row">
          <span className="settings-label">Your name</span>
          <input
            className="settings-input"
            value={name}
            placeholder="A name or nickname"
            onChange={(e) => setName(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
            }}
          />
          <span className="muted">{name.trim() ? `shown as "${name.trim()}님"` : 'shown as "Manager"'}</span>
        </label>
        <div className="settings-row">
          <span className="settings-label">Theme</span>
          <div className="seg-toggle" role="radiogroup" aria-label="Theme">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                className={theme === t ? 'on' : ''}
                onClick={() => {
                  setTheme(t);
                  setThemePref(t);
                }}
              >
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">Agents</span>
          <button
            className="btn sm"
            onClick={() => {
              close();
              useStore.getState().openAgents();
            }}
          >
            Connections…
          </button>
          <span className="muted">Claude · Codex · Gemini install and sign-in</span>
        </div>
        <div className="actions">
          <span className="grow" />
          <button className="btn primary" onClick={() => { save(); close(); }}>Done</button>
        </div>
      </div>
    </div>
  );
}
