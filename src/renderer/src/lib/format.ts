import type { AgentKind, SessionStatus } from '@shared/protocol';

export const AGENT_COLORS: Record<AgentKind, string> = {
  claude: '#d97757',
  codex: '#10a37f',
  gemini: '#4285f4',
  ollama: '#8a8a90',
  shell: '#b8b8be',
  custom: '#b8b8be'
};

/**
 * Session name as shown: drops a leading 1.x role ("Head Coach · 쇼핑몰" → "쇼핑몰"). The stored title keeps it —
 * agents address each other by title.
 */
export function displayTitle(s: { title: string }): string {
  const t = s.title.replace(/^(Head Coach|Playing Coach|Part Coach|Coach|Player) · /, '');
  return t || s.title;
}

/** Project label of a session. */
export function projectLabel(projectId: string, projects: { id: string; name: string }[]): string {
  return projects.find((x) => x.id === projectId)?.name ?? '?';
}

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  ollama: 'Ollama',
  shell: 'Shell',
  custom: 'Custom'
};

export const STATUS_LABELS: Record<SessionStatus, string> = {
  starting: 'Starting',
  working: 'Working',
  waiting: 'Waiting',
  done: 'Done',
  error: 'Error',
  hibernated: 'Hibernated'
};

/** 'waiting' splits in two for display: a question on screen ("Needs input", pulsing) or just idle (still dot). */
export function statusClass(s: { status: SessionStatus; attention?: boolean; limit?: string }): string {
  // attention / limit are sent by the daemon; an older daemon sends none, and then waiting stays waiting
  if (s.status === 'waiting' && s.limit) return 'limit';
  return s.status === 'waiting' && s.attention === false ? 'idle' : s.status;
}
export function statusLabel(s: { status: SessionStatus; attention?: boolean; limit?: string }): string {
  if (s.status === 'waiting' && s.limit) return 'Limit';
  if (s.status === 'waiting' && s.attention !== undefined) return s.attention ? 'Needs input' : 'Idle';
  return STATUS_LABELS[s.status];
}

export const STATUS_ICONS: Record<SessionStatus, string> = {
  starting: '…',
  working: '●',
  waiting: '?',
  done: '✓',
  error: '!',
  hibernated: '◌'
};

export function agentColor(agent: AgentKind, override?: string): string {
  return override || AGENT_COLORS[agent] || AGENT_COLORS.custom;
}

export function formatElapsed(fromMs: number, nowMs = Date.now()): string {
  let s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "Today 14:40", "Yesterday 09:12", "10-18 11:00" — when a conversation turn happened. */
export function dayTime(ms: number, nowMs = Date.now()): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const day = (t: number): string => new Date(t).toDateString();
  if (day(ms) === day(nowMs)) return `Today ${hm}`;
  if (day(ms) === day(nowMs - 86_400_000)) return `Yesterday ${hm}`;
  return `${String(d.getFullYear()).slice(2)}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

export function relativeTime(ms: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The project of a project id. */
export function projectOf<P extends { id: string }>(projectId: string, projects: P[]): P | undefined {
  return projects.find((x) => x.id === projectId);
}

/** A project's color, for tags, the tree and the Ground frame. */
export function projectColor(projectId: string, projects: { id: string; color?: string }[]): string {
  return projectOf(projectId, projects)?.color ?? '#64748b';
}

/** A Windows path as a comparison key: backslashes, no trailing separator, lower case. */
export const normPath = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

/** CSS custom property carrying a project color: style={pcStyle(color)}, used as var(--pc) in styles.css. */
export function pcStyle(color: string): Record<string, string> {
  return { '--pc': color };
}
