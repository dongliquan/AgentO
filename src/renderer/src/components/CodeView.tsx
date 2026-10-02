import { useMemo } from 'react';

/** <pre>-like code view with line numbers. */
export function CodeView({ content, maxLines = 5000 }: { content: string; maxLines?: number }): JSX.Element {
  const lines = useMemo(() => {
    const all = content.replace(/\r\n?/g, '\n').split('\n');
    return all.length > maxLines ? all.slice(0, maxLines) : all;
  }, [content, maxLines]);
  return (
    <div className="code">
      {lines.map((l, i) => (
        <div className="ln" key={i}>
          <span className="n">{i + 1}</span>
          <span className="c">{l || ' '}</span>
        </div>
      ))}
      {content.split('\n').length > maxLines && <div className="ln"><span className="n" /><span className="c muted">… (line limit reached)</span></div>}
    </div>
  );
}
