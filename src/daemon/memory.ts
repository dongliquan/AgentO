import fs from 'node:fs';
import path from 'node:path';
import { dataDir, ensureDir } from './paths';

/**
 * Project memory: one short Markdown file per project that every session of the project gets at start (appended to
 * its system prompt) and keeps current with the `update_memory` tool — decisions, conventions, where things are,
 * traps, open questions. It carries what a fresh session would otherwise rediscover by reading the code again, so
 * conversations can stay short (the fresh start's handoff note is per session; this is per project).
 *
 * Kept deliberately small: one line per fact, a cap on lines and size — it is read on every call of every session.
 */
export const MEMORY_SECTIONS = ['Decisions', 'Conventions', 'Map', "Don't", 'Open'] as const;
export type MemorySection = (typeof MEMORY_SECTIONS)[number];
export type MemoryMode = 'append' | 'replace' | 'remove';

const SECTION_HELP: Record<MemorySection, string> = {
  Decisions: 'what was decided and why (one line each)',
  Conventions: 'how things are done here: naming, branches, commit style, test commands',
  Map: 'where things are: folders, key files, entry points, generated files',
  "Don't": 'traps and things not to do',
  Open: 'open questions and things waiting on someone'
};

/** per section and in all: it is appended to every call's system prompt */
const MAX_SECTION_LINES = 20;
const MAX_LINES = 60;
const MAX_CHARS = 6000;
const MAX_LINE_CHARS = 240;

export function memoryDir(): string {
  return ensureDir(path.join(dataDir(), 'team', 'memory'));
}

export function memoryPath(projectId: string): string {
  return path.join(memoryDir(), `${projectId}.md`);
}

const template = (name: string): string =>
  `# Project memory — ${name}\n\n` +
  `<!-- agento:memory — shared by every session of the project: given to each at start, kept current with the update_memory tool. One line per fact. -->\n\n` +
  MEMORY_SECTIONS.map((s) => `## ${s}\n`).join('\n');

/** The file exists (a template when new); its path. */
export function ensureMemory(projectId: string, name: string): string {
  const p = memoryPath(projectId);
  if (!fs.existsSync(p)) fs.writeFileSync(p, template(name));
  return p;
}

interface Parsed {
  head: string;
  sections: Map<MemorySection, string[]>;
}

function parse(text: string): Parsed {
  const sections = new Map<MemorySection, string[]>();
  for (const s of MEMORY_SECTIONS) sections.set(s, []);
  const lines = text.split(/\r?\n/);
  let head = '';
  let cur: MemorySection | null = null;
  const headLines: string[] = [];
  for (const line of lines) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) {
      cur = (MEMORY_SECTIONS as readonly string[]).includes(m[1]!) ? (m[1] as MemorySection) : null;
      continue;
    }
    if (cur) {
      if (line.trim()) sections.get(cur)!.push(line.replace(/\s+$/, ''));
    } else headLines.push(line);
  }
  head = headLines.join('\n').replace(/\n+$/, '');
  return { head, sections };
}

function render(p: Parsed): string {
  return `${p.head}\n\n${MEMORY_SECTIONS.map((s) => `## ${s}\n${p.sections.get(s)!.map((l) => `${l}\n`).join('')}`).join('\n')}`;
}

/** Lines as the memory keeps them: one fact per line, as a list item, trimmed, not too long. */
function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[-*] /.test(l) ? `- ${l.slice(2).trim()}` : `- ${l}`))
    .map((l) => (l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS - 1)}…` : l));
}

export function readMemory(projectId: string): string | undefined {
  try {
    return fs.readFileSync(memoryPath(projectId), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Change one section: append lines (duplicates dropped), replace the section, or remove the lines containing a text.
 * Over the caps the change is refused with what to condense — the memory must stay short.
 */
export function updateMemory(projectId: string, name: string, section: MemorySection, text: string, mode: MemoryMode): { ok: true; lines: number; total: number } | { error: string } {
  ensureMemory(projectId, name);
  const parsed = parse(readMemory(projectId) ?? template(name));
  const cur = parsed.sections.get(section)!;
  let next: string[];
  if (mode === 'remove') {
    const needle = text.trim().toLowerCase();
    if (!needle) return { error: 'remove: say which text the lines to drop contain' };
    next = cur.filter((l) => !l.toLowerCase().includes(needle));
    if (next.length === cur.length) return { error: `remove: no line in ${section} contains "${text.trim()}"` };
  } else {
    const add = toLines(text);
    if (!add.length) return { error: 'text is empty' };
    next = mode === 'replace' ? add : [...cur, ...add.filter((l) => !cur.some((c) => c.toLowerCase() === l.toLowerCase()))];
  }
  if (next.length > MAX_SECTION_LINES) return { error: `${section} would have ${next.length} lines; the cap is ${MAX_SECTION_LINES}. Condense (mode "replace" with the essentials) or remove outdated lines first.` };
  parsed.sections.set(section, next);
  const total = [...parsed.sections.values()].reduce((n, l) => n + l.length, 0);
  const out = render(parsed);
  if (total > MAX_LINES || out.length > MAX_CHARS) return { error: `The memory would be ${total} lines / ${out.length} chars; the caps are ${MAX_LINES} lines / ${MAX_CHARS} chars. Condense or remove outdated lines first.` };
  fs.writeFileSync(memoryPath(projectId), out);
  return { ok: true, lines: next.length, total };
}

/** The memory as a system-prompt addition (only the sections with content); undefined while it is empty. */
export function memorySystemPrompt(projectId: string, name: string): string | undefined {
  const text = readMemory(projectId);
  if (!text) return undefined;
  const parsed = parse(text);
  const parts = MEMORY_SECTIONS.filter((s) => parsed.sections.get(s)!.length).map((s) => `## ${s}\n${parsed.sections.get(s)!.join('\n')}`);
  if (!parts.length) return undefined;
  return (
    `# Project memory — ${name} (AgentO)\n` +
    `Shared by every session of this project and given to each at start. Trust it over rediscovering; when you learn a ` +
    `decision, convention, location or trap the others need, add one line with the update_memory tool (sections: ` +
    `${MEMORY_SECTIONS.join(', ')}); replace or remove lines that are outdated.\n\n${parts.join('\n\n')}`
  );
}

export const MEMORY_MODES_HELP = 'append (default; duplicates dropped) · replace (the whole section) · remove (drop the lines containing the text)';

export const MEMORY_TOOL_DESCRIPTION =
  `Add to, replace or trim the project memory — the short shared note every session of the project gets at start ` +
  `(decisions, conventions, where things are, traps, open questions). One line per fact; the others read it on every ` +
  `call, so keep it short (caps: ${MAX_SECTION_LINES} lines per section, ${MAX_LINES} in all). Sections: ` +
  MEMORY_SECTIONS.map((s) => `${s} = ${SECTION_HELP[s]}`).join('; ') +
  `. Modes: append (default; duplicates dropped), replace (the whole section), remove (drop the lines containing the text).`;
