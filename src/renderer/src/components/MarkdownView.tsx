import { useMemo } from 'react';
import { renderMarkdown } from '@/lib/markdown';

export function MarkdownView({ content }: { content: string }): JSX.Element {
  const html = useMemo(() => renderMarkdown(content), [content]);
  // renderMarkdown escapes all user text; only our own tags are emitted.
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
