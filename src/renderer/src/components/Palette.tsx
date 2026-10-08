import type { AgentKind } from '@shared/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/store';
import { closedSessionIds } from '@/lib/closedIds';
import { openFile } from '@/lib/openfile';
import { COMMANDS, runCommand, selectAndReveal } from '@/commands';
import { AGENT_LABELS, STATUS_LABELS, agentColor, basename } from '@/lib/format';
import { send } from '@/client';
import { AgentIcon } from './AgentIcon';

interface Item {
  id: string;
  kind: 'Session' | 'Folder' | 'File' | 'Project' | 'Command';
  label: string;
  sub?: string;
  color?: string;
  agent?: AgentKind;
  run: () => void;
}

function match(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  if (t.includes(s)) return 2 + (t.startsWith(s) ? 1 : 0);
  // subsequence
  let i = 0;
  for (const ch of t) if (ch === s[i]) i++;
  return i === s.length ? 1 : 0;
}

export function Palette(): JSX.Element {
  const mode = useStore((s) => s.paletteMode);
  const close = useStore((s) => s.closePalette);
  const openPalette = useStore((s) => s.openPalette);
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const openFileCard = useStore((s) => s.openFileCard);
  const [q, setQ] = useState(mode === 'command' ? '>' : '');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setQ((prev) => {
      if (mode === 'command' && !prev.startsWith('>')) return `>${prev}`;
      if (mode === 'quick' && prev.startsWith('>')) return prev.slice(1);
      return prev;
    });
  }, [mode]);

  const isCmd = q.startsWith('>');
  const query = isCmd ? q.slice(1).trim() : q.trim();
  // file names under the project folders: asked from the daemon as you type (from 2 characters)
  const fileSearch = useStore((s) => s.fileSearch);
  useEffect(() => {
    if (isCmd || query.length < 2) return;
    const t = setTimeout(() => send({ type: 'fs.search', ref: query, query }), 150);
    return () => clearTimeout(t);
  }, [isCmd, query]);
  const files = !isCmd && query.length >= 2 && fileSearch?.ref === query ? fileSearch.items : [];
  const openViewerTab = useStore((s) => s.openViewerTab);

  const items = useMemo<Item[]>(() => {
    if (isCmd) {
      return COMMANDS.filter((c) => !c.id.startsWith('go.next-waiting')).map((c) => ({ id: c.id, kind: 'Command', label: c.label, sub: c.shortcut, run: () => runCommand(c.id) }));
    }
    const out: Item[] = [];
    const closed = closedSessionIds(sessions.values(), projects);
    for (const s of sessions.values()) {
      if (closed.has(s.id)) continue;
      out.push({ id: `s:${s.id}`, kind: 'Session', label: s.title, sub: `${AGENT_LABELS[s.agent]} · ${STATUS_LABELS[s.status]}`, color: agentColor(s.agent, s.color), agent: s.agent, run: () => selectAndReveal(s.id) });
    }
    for (const p of projects) {
      out.push({ id: `p:${p.id}`, kind: 'Project', label: p.name, sub: `${p.folders.length} folder${p.folders.length === 1 ? '' : 's'}`, run: () => useStore.getState().setActivity('projects') });
      for (const f of p.folders) {
        out.push({ id: `f:${f.id}`, kind: 'Folder', label: f.name, sub: f.path, run: () => useStore.getState().openNewSession({ projectId: p.id, folderId: f.id }) });
        const changed = useStore.getState().changed.get(f.path) ?? [];
        for (const e of changed) out.push({ id: `c:${e.path}`, kind: 'File', label: e.name, sub: e.path, run: () => openFile(e.path, f.path) });
      }
    }
    return out;
  }, [isCmd, sessions, projects, openFileCard]);

  const filtered = useMemo(() => {
    const changed = new Set(items.filter((it) => it.kind === 'File').map((it) => it.sub));
    const found: Item[] = files
      .filter((f) => !changed.has(f.path))
      .map((f) => ({
        id: `ff:${f.path}`,
        kind: 'File',
        label: basename(f.path),
        sub: f.path,
        run: () => openFile(f.path, '')
      }));
    const daemonHits = new Set(found.map((f) => f.id));
    return [...items, ...found]
      // a file the daemon found by its folder path ranks low but stays in the list
      .map((it) => ({ it, score: Math.max(match(query, it.label), match(query, it.sub ?? '') * 0.5, daemonHits.has(it.id) ? 0.1 : 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((x) => x.it);
  }, [items, query, files, openViewerTab]);

  useEffect(() => setIdx(0), [query, isCmd]);

  const run = (it: Item | undefined): void => {
    if (!it) return;
    close();
    it.run();
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette">
        <input
          ref={inputRef}
          value={q}
          placeholder={isCmd ? 'Search commands…' : 'Search sessions, folders, changed files… (type > for commands)'}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            if (v.startsWith('>') && mode !== 'command') openPalette('command');
            if (!v.startsWith('>') && mode !== 'quick') openPalette('quick');
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(filtered[idx]); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
        />
        <div className="list">
          {filtered.length === 0 && <div className="tree-empty">No results</div>}
          {filtered.map((it, i) => (
            <div key={it.id} className={`pitem ${i === idx ? 'active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
              {/* in command mode (">") every row is a command: no label column */}
              {!isCmd && <span className="kind">{it.kind}</span>}
              {it.agent ? <AgentIcon kind={it.agent} color={it.color} /> : it.color && <span className="agent-square" style={{ background: it.color }} />}
              <span className="ellipsis">{it.label}</span>
              {it.sub && <span className="sub ellipsis" style={{ maxWidth: 240 }}>{it.sub}</span>}
            </div>
          ))}
        </div>
        <div className="hint">↑↓ Navigate · Enter Run · Esc Close · {isCmd ? 'Delete ">" for Quick Open' : 'Type ">" for commands'}</div>
      </div>
    </div>
  );
}
