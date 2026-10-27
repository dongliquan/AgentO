/**
 * Team messages typed into a session by the daemon (src/daemon/team.ts) start with a header:
 *   [Message from "<title>" (<role>, session <id>)( — #T12)]   — another session (the id: 8 chars or full)
 *   [Order from the manager (the user)( — <via>)( — #T12)]       — the user (Manager tab, or a routine)
 *   [AgentO] …                                         — automatic notices (a directed session finished, role changes)
 * Several queued messages arrive as one paste, separated by blank lines. This splits and parses them.
 */
export interface TeamMessage {
  kind: 'session' | 'order' | 'notice';
  /** sender: a session title, "Manager (you)", or "AgentO" */
  from: string;
  role?: string;
  sessionId?: string;
  /** an AgentO notice about a session ("<title>" (<role>, session <id>) finished …): that session's id or id prefix */
  aboutId?: string;
  /** e.g. 'Routine "Daily stand-up" #3' */
  via?: string;
  /** the piece of work the message is about ("#T12"): from its header, or an AgentO notice's "(#T12)" */
  taskId?: string;
  body: string;
}

const HEADER = /^(?:\[Message from "(.+?)" \(([^,]+), session ([0-9a-f-]{6,36})\)(?: — (#T\d+))?\]|\[Order from the manager \(the user\)(?: — (.+?))?\]|\[AgentO\])/;

/** null when the text is not a team message (plain user input). */
export function parseTeamMessages(raw: string): TeamMessage[] | null {
  // Claude Code records a long paste wrapped in <pasted_content id="…"> … </pasted_content>
  const text = raw.replace(/^\s*<pasted_content\b[^>]*>\s*/, '').replace(/\s*<\/pasted_content>\s*$/, '');
  if (!HEADER.test(text)) return null;
  const out: TeamMessage[] = [];
  const lines = text.split('\n');
  let cur: TeamMessage | null = null;
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m) {
      if (cur) out.push(cur);
      const rest = line.slice(m[0].length).trim();
      if (m[1]) cur = { kind: 'session', from: m[1], role: m[2], sessionId: m[3], ...(m[4] ? { taskId: m[4] } : {}), body: rest };
      else if (line.startsWith('[Order')) {
        // "— <via> — #T12", "— #T12" or "— <via>"
        const tail = m[5] ?? '';
        const t = /(?:^| — )(#T\d+)$/.exec(tail);
        const via = t ? tail.slice(0, t.index) : tail;
        cur = { kind: 'order', from: 'Manager (you)', ...(via ? { via } : {}), ...(t ? { taskId: t[1] } : {}), body: rest };
      }
      else cur = { kind: 'notice', from: 'AgentO', body: rest };
      continue;
    }
    if (cur) cur.body += (cur.body ? '\n' : '') + line;
  }
  if (cur) out.push(cur);
  for (const t of out) {
    t.body = t.body.trim();
    if (t.kind === 'notice') {
      const m = /^"[^"]*" \([^,]+, session ([0-9a-f-]{6,36})\)/.exec(t.body);
      if (m) t.aboutId = m[1];
      const task = /the task you sent \((#T\d+)\)/.exec(t.body.slice(0, 300));
      if (task) t.taskId = task[1];
    }
  }
  return out;
}
