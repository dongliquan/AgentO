import type { AgentKind } from '@shared/protocol';
import { AGENT_LABELS, agentColor } from '@/lib/format';

/** Generic per-agent glyphs (not vendor logos), drawn in white on the agent color. */
const GLYPHS: Record<AgentKind, JSX.Element> = {
  // radial burst
  claude: (
    <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7" />
    </g>
  ),
  // hexagon
  codex: <path d="M12 4.5 18.5 8.25v7.5L12 19.5l-6.5-3.75v-7.5Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />,
  // four-point star
  gemini: <path d="M12 3.5c.7 4.6 3.9 7.8 8.5 8.5-4.6.7-7.8 3.9-8.5 8.5-.7-4.6-3.9-7.8-8.5-8.5 4.6-.7 7.8-3.9 8.5-8.5Z" fill="currentColor" />,
  // ring
  ollama: <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2.4" />,
  // prompt
  shell: (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 8 4 4-4 4M12 17h6" />
    </g>
  ),
  // plus
  custom: (
    <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 6v12M6 12h12" />
    </g>
  )
};

export function AgentIcon({ kind, color, size = 14, title }: { kind: AgentKind; color?: string; size?: number; title?: string }): JSX.Element {
  return (
    <span className="agent-icon" style={{ background: agentColor(kind, color), width: size, height: size }} title={title ?? AGENT_LABELS[kind]}>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.78)} height={Math.round(size * 0.78)} aria-hidden="true">
        {GLYPHS[kind] ?? GLYPHS.custom}
      </svg>
    </span>
  );
}
