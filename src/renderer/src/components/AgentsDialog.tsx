import { useEffect, useState } from 'react';
import type { AgentConnection } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { AgentIcon } from './AgentIcon';

type Kind = 'claude' | 'codex' | 'gemini';

function state(c: AgentConnection): { cls: string; label: string } {
  if (!c.installed) return { cls: 'off', label: 'Not installed' };
  if (c.signedIn === false) return { cls: 'warn', label: 'Not signed in' };
  if (c.signedIn === null) return { cls: 'ok', label: 'Installed' };
  return { cls: 'ok', label: 'Ready' };
}

/**
 * Agents › Connections: the agent CLIs AgentO drives, installed or not, signed in or not. Install / Sign in open a
 * terminal window running the CLI's own installer or sign-in (a browser login); AgentO keeps no credentials.
 */
export function AgentsDialog(): JSX.Element | null {
  const open = useStore((s) => s.agentsOpen);
  const close = useStore((s) => s.closeAgents);
  const items = useStore((s) => s.agentConnections);
  const [checking, setChecking] = useState(false);

  const check = (): void => {
    setChecking(true);
    send({ type: 'agents.status' });
  };
  useEffect(() => {
    if (open) check();
  }, [open]);
  useEffect(() => setChecking(false), [items]);
  // after an install / sign-in window, the state changes outside AgentO: look again when the window gets focus back
  useEffect(() => {
    if (!open) return;
    const onFocus = (): void => check();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [open]);

  if (!open) return null;
  const run = (kind: Kind, action: 'install' | 'login'): void => void window.desktop.agentTerminal(kind, action);

  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog agents-dialog">
        <h3>Agent Connections</h3>
        <div className="muted field-hint">
          AgentO runs these CLIs with their own sign-in (your subscription). Install or sign in opens a terminal window;
          come back here when it is done.
        </div>
        <div className="agent-list">
          {(items ?? []).map((c) => {
            const st = state(c);
            return (
              <div key={c.kind} className="agent-row">
                <AgentIcon kind={c.kind} size={18} />
                <div className="agent-main">
                  <div className="agent-head">
                    <span className="agent-name">{c.label}</span>
                    <span className={`agent-state ${st.cls}`}>
                      <span className="dot" />
                      {st.label}
                    </span>
                    {c.version && <span className="muted agent-ver">{c.version}</span>}
                  </div>
                  {c.path && <div className="agent-path" title={c.path}>{c.path}</div>}
                  {c.note && <div className="agent-note">{c.note}</div>}
                </div>
                <div className="agent-actions">
                  {!c.installed && (
                    <button className="btn sm primary" onClick={() => run(c.kind as Kind, 'install')}>
                      Install
                    </button>
                  )}
                  {c.installed && (
                    <button className={`btn sm ${c.signedIn === false ? 'primary' : ''}`} onClick={() => run(c.kind as Kind, 'login')}>
                      {c.signedIn === false ? 'Sign in' : 'Sign in again'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {!items && <div className="muted">Checking…</div>}
        </div>
        <div className="actions">
          <button className="btn" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
          <span className="grow" />
          <button className="btn primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
