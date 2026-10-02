import { useEffect, useRef } from 'react';
import type { AgentKind } from '@shared/protocol';
import { useStore } from '@/store';
import { AGENT_LABELS, agentColor } from '@/lib/format';
import { AgentIcon } from './AgentIcon';

interface Props {
  x: number;
  y: number;
  onPick: (agent: AgentKind) => void;
  onMore?: () => void;
  onClose: () => void;
  /** only these agents (default: all) */
  kinds?: AgentKind[];
  /** heading shown above the list */
  title?: string;
}

const DEFAULT_KINDS: AgentKind[] = ['claude', 'codex', 'gemini', 'ollama', 'shell'];

/** Popover listing available agents. */
export function AgentPicker({ x, y, onPick, onMore, onClose, kinds, title }: Props): JSX.Element {
  const agents = useStore((s) => s.agents);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const all = agents.length ? agents : DEFAULT_KINDS.map((kind) => ({ kind, label: AGENT_LABELS[kind], command: '', args: [], color: agentColor(kind), available: undefined }));
  const list = kinds ? kinds.map((k) => all.find((a) => a.kind === k)).filter((a): a is (typeof all)[number] => a !== undefined) : all;
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 40 * (list.length + 2));

  return (
    <div className="popover" ref={ref} style={{ left, top }}>
      {title && <div className="popover-title">{title}</div>}
      {list.map((a) => (
        <button key={a.kind} className={`item ${a.available === false ? 'disabled' : ''}`} onClick={() => onPick(a.kind)} title={a.available === false ? 'Not installed' : a.command}>
          <AgentIcon kind={a.kind} color={a.color} />
          <span>{a.label || AGENT_LABELS[a.kind]}</span>
          {a.available === false && <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>Not installed</span>}
        </button>
      ))}
      {onMore && (
        <>
          <div className="sep" />
          <button className="item" onClick={onMore}>New Session with Options…</button>
        </>
      )}
    </div>
  );
}
