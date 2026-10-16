import { createContext, useContext } from 'react';
import type { ChatEntry, ChatTool, Project, Session } from '@shared/protocol';
import { parseTeamMessages } from './teamMessage';
import { projectColor, rootProject } from './format';

/**
 * Which project (in the team-wide Head Coach's chat) or which part (in a project Coach's chat) a team message or a tool
 * call is about — the label next to it. Other sessions' chats get none.
 */
export interface Scope {
  name: string;
  color: string;
}

export interface Scoper {
  ofSession: (ref: string) => Scope | null;
  ofProject: (projectId: string) => Scope | null;
  /** a user turn (an order) → the scopes its work touched */
  turns: Map<string, Scope[]>;
}

export const ScopeCtx = createContext<Scoper | null>(null);
export const useScoper = (): Scoper | null => useContext(ScopeCtx);

/** The scope a tool call is about: the session it addresses, the part it creates a player in, the project it starts. */
export function toolScope(t: ChatTool, sc: Scoper): Scope | null {
  if (!t.name.startsWith('mcp__agento__')) return null;
  const i = t.input;
  if (typeof i['session_id'] === 'string') return sc.ofSession(i['session_id']);
  if (typeof i['project_id'] === 'string') return sc.ofProject(i['project_id']);
  if (typeof i['part_id'] === 'string') return sc.ofProject(i['part_id']);
  return null;
}

export function makeScoper(viewer: Session, sessions: Map<string, Session>, projects: Project[], entries: ChatEntry[]): Scoper | null {
  if (viewer.role !== 'head') return null;
  const teamWide = !viewer.projectId;
  const ofProject = (pid: string): Scope | null => {
    const p = projects.find((x) => x.id === pid);
    if (!p) return null;
    if (teamWide) {
      const root = rootProject(p.id, projects) ?? p;
      return { name: root.name, color: projectColor(root.id, projects) };
    }
    // a project's Coach: only its parts are worth a label
    return p.parentId === viewer.projectId ? { name: p.name, color: projectColor(p.id, projects) } : null;
  };
  const list = [...sessions.values()];
  const ofSession = (ref: string): Scope | null => {
    const r = ref.trim();
    const s = sessions.get(r) ?? (r.length >= 6 ? list.find((x) => x.id.startsWith(r)) : undefined) ?? list.find((x) => x.title === r);
    if (!s || s.id === viewer.id) return null;
    return s.projectId ? ofProject(s.projectId) : null;
  };
  const sc: Scoper = { ofSession, ofProject, turns: new Map() };
  // each user turn: the scopes of the messages in it and of the tool calls that follow, up to the next user turn
  let turn: Scope[] | null = null;
  const add = (x: Scope | null): void => {
    if (x && turn && !turn.some((y) => y.name === x.name)) turn.push(x);
  };
  for (const e of entries) {
    if (e.kind === 'user') {
      turn = [];
      sc.turns.set(e.id, turn);
      for (const m of (e.text && parseTeamMessages(e.text)) || []) {
        const ref = m.sessionId ?? m.aboutId;
        if (ref) add(ofSession(ref));
      }
    } else if (e.kind === 'tool' && e.tool) add(toolScope(e.tool, sc));
  }
  return sc;
}
