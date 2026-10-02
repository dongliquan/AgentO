import { useMemo, useState } from 'react';
import { CodeView } from './CodeView';

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export function JsonTree({ content }: { content: string }): JSX.Element {
  const parsed = useMemo<{ ok: true; value: JsonValue } | { ok: false; error: string }>(() => {
    try {
      return { ok: true, value: JSON.parse(content) as JsonValue };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [content]);
  if (!parsed.ok) {
    return (
      <>
        <div className="diff-note">Failed to parse JSON: {parsed.error}</div>
        <CodeView content={content} />
      </>
    );
  }
  return (
    <div className="json-tree">
      <Node value={parsed.value} depth={0} />
    </div>
  );
}

function Node({ value, name, depth }: { value: JsonValue; name?: string; depth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < 2);
  const key = name !== undefined ? <span className="k">"{name}"</span> : null;
  const sep = name !== undefined ? ': ' : '';

  if (value === null) return <div>{key}{sep}<span className="z">null</span></div>;
  if (typeof value === 'string') return <div>{key}{sep}<span className="s">"{value.length > 500 ? `${value.slice(0, 500)}…` : value}"</span></div>;
  if (typeof value === 'number') return <div>{key}{sep}<span className="n">{String(value)}</span></div>;
  if (typeof value === 'boolean') return <div>{key}{sep}<span className="b">{String(value)}</span></div>;

  const isArr = Array.isArray(value);
  const entries: [string, JsonValue][] = isArr ? (value as JsonValue[]).map((v, i) => [String(i), v]) : Object.entries(value as { [k: string]: JsonValue });
  const [o, c] = isArr ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) return <div>{key}{sep}{o}{c}</div>;
  return (
    <div>
      <span className="tg" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</span>
      {key}{sep}{o}
      {!open && <span className="z"> … {entries.length} </span>}
      {open && (
        <div className="node">
          {entries.map(([k, v]) => (
            <Node key={k} name={isArr ? undefined : k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
      {!open ? c : <div>{c}</div>}
    </div>
  );
}
