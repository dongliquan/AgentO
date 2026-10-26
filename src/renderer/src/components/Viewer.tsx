import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { requestRead } from '@/client';
import { extname, formatBytes } from '@/lib/format';
import { CodeView } from './CodeView';
import { MarkdownView } from './MarkdownView';
import { JsonTree } from './JsonTree';
import { CsvTable } from './CsvTable';
import { languageOf } from '@/lib/highlight';

type Mode = 'render' | 'raw' | 'edit';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
/** opened by the system instead (no preview here) */
const BINARY = new Set(['pdf', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'zip', '7z', 'gz', 'tar', 'jar', 'war', 'exe', 'dll', 'class', 'mp4', 'mov', 'mp3', 'wav']);

export function Viewer({ path }: { path: string }): JSX.Element {
  const file = useStore((s) => s.fileContents.get(path));
  const ext = extname(path);
  const image = IMAGE.has(ext);
  const binary = BINARY.has(ext);
  // Rendered: Markdown, JSON tree, CSV table, the picture of an SVG, a sandboxed HTML page
  const renderable = ['md', 'markdown', 'json', 'csv', 'tsv', 'svg', 'html', 'htm'].includes(ext);
  const [mode, setMode] = useState<Mode>(renderable ? 'render' : 'raw');
  const lang = languageOf(path);
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (image || binary) return;
    requestRead(path, true);
  }, [path, image, binary]);
  useEffect(() => {
    setDataUrl(undefined);
    if (image || (ext === 'svg' && mode === 'render')) void window.desktop.fileDataUrl(path).then(setDataUrl);
  }, [path, image, ext, mode]);

  let body: JSX.Element;
  if (binary) {
    body = (
      <div className="viewer-binary">
        <div>No preview for .{ext} files here.</div>
        <button className="btn sm" onClick={() => void window.desktop.openPath(path)}>Open with the default app</button>
      </div>
    );
  } else if (image || (ext === 'svg' && mode === 'render')) {
    body =
      dataUrl === undefined ? <div className="tree-empty">Loading…</div>
      : dataUrl === null ? <div className="viewer-binary">The image could not be read (too large or unreadable).</div>
      : <div className="viewer-image"><img src={dataUrl} alt={path} /></div>;
  } else if (!file) body = <div className="tree-empty">Loading…</div>;
  else if (mode === 'raw' || !renderable) body = <CodeView content={file.content} maxLines={20000} lang={lang} />;
  else if (ext === 'md' || ext === 'markdown') body = <MarkdownView content={file.content} />;
  else if (ext === 'json') body = <JsonTree content={file.content} />;
  else if (ext === 'html' || ext === 'htm')
    // sandboxed: no scripts, no same-origin access; relative images/styles of the page do not load
    body = <iframe className="viewer-html" sandbox="" srcDoc={file.content} title={path} />;
  else body = <CsvTable content={file.content} ext={ext} />;

  return (
    <>
      <div className="viewer-toolbar">
        <div className="segmented">
          <button className={mode === 'render' || image ? 'active' : ''} disabled={!renderable && !image} onClick={() => setMode('render')}>Rendered</button>
          <button className={mode === 'raw' && !image ? 'active' : ''} disabled={image || binary} onClick={() => setMode('raw')}>Raw</button>
          <button disabled title="Editing is coming soon">Edit</button>
        </div>
        <span className="muted ellipsis" style={{ flex: 1, fontSize: 12 }} title={path}>{path}</span>
        {file && !image && !binary && <span className="muted" style={{ fontSize: 11 }}>{lang ? `${lang} · ` : ''}{formatBytes(file.content.length)}{file.truncated ? ' (truncated)' : ''}</span>}
        <button className="btn sm" onClick={() => requestRead(path, true)}>Refresh</button>
        <button className="btn sm" onClick={() => void window.desktop.openInVsCode(path)}>VS Code</button>
      </div>
      <div className="viewer-main">{body}</div>
    </>
  );
}
