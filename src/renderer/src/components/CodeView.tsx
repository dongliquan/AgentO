import { useMemo } from 'react';
import { highlight } from '@/lib/highlight';

/** <pre>-like code view with line numbers; with `lang`, syntax-coloured (highlight.js, escaped output). */
export function CodeView({ content, maxLines = 5000, lang }: { content: string; maxLines?: number; lang?: string }): JSX.Element {
  const text = useMemo(() => {
    const all = content.replace(/\r\n?/g, '\n').split('\n');
    return { lines: all.length > maxLines ? all.slice(0, maxLines) : all, cut: all.length > maxLines };
  }, [content, maxLines]);
  const html = useMemo(() => (lang ? highlight(text.lines.join('\n'), lang) : null), [text, lang]);

  if (html !== null) {
    return (
      <div className="code code-hl">
        <pre className="gutter" aria-hidden="true">
          {text.lines.map((_, i) => `${i + 1}\n`).join('')}
        </pre>
        {/* highlight.js escapes the source; only its own <span class="hljs-…"> tags are emitted */}
        <pre className="src hljs" dangerouslySetInnerHTML={{ __html: html }} />
        {text.cut && <div className="ln"><span className="n" /><span className="c muted">… (line limit reached)</span></div>}
      </div>
    );
  }
  return (
    <div className="code">
      {text.lines.map((l, i) => (
        <div className="ln" key={i}>
          <span className="n">{i + 1}</span>
          <span className="c">{l || ' '}</span>
        </div>
      ))}
      {text.cut && <div className="ln"><span className="n" /><span className="c muted">… (line limit reached)</span></div>}
    </div>
  );
}
