import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { requestRead } from '@/client';
import { extname, fileIcon, formatBytes } from '@/lib/format';
import { CodeView } from './CodeView';
import { MarkdownView } from './MarkdownView';
import { JsonTree } from './JsonTree';
import { CsvTable } from './CsvTable';

type Mode = 'render' | 'raw' | 'edit';

export function ViewerTabs(): JSX.Element {
  const tabs = useStore((s) => s.viewerTabs);
  const activeId = useStore((s) => s.activeTabId);
  const setActive = useStore((s) => s.setActiveTab);
  const close = useStore((s) => s.closeViewerTab);
  const setCenterView = useStore((s) => s.setCenterView);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[tabs.length - 1];

  if (!active) {
    return (
      <div className="board-empty" style={{ position: 'relative', flex: 1 }}>
        <div>No open files</div>
        <button className="btn" onClick={() => setCenterView('sessions')}>Back to Sessions</button>
      </div>
    );
  }

  return (
    <div className="viewer">
      <div className="tabstrip">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${t.id === active.id ? 'active' : ''}`} onClick={() => setActive(t.id)} title={t.path}>
            <span className="mono muted" style={{ fontSize: 10 }}>{fileIcon(t.name)}</span>
            <span className="ellipsis">{t.name}</span>
            <span
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                close(t.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
      </div>
      <Viewer key={active.id} path={active.path} />
    </div>
  );
}

function Viewer({ path }: { path: string }): JSX.Element {
  const file = useStore((s) => s.fileContents.get(path));
  const ext = extname(path);
  const renderable = ext === 'md' || ext === 'markdown' || ext === 'json' || ext === 'csv' || ext === 'tsv';
  const [mode, setMode] = useState<Mode>(renderable ? 'render' : 'raw');

  useEffect(() => {
    requestRead(path, true);
  }, [path]);

  let body: JSX.Element;
  if (!file) body = <div className="tree-empty">Loading…</div>;
  else if (mode === 'raw' || !renderable) body = <CodeView content={file.content} maxLines={20000} />;
  else if (ext === 'md' || ext === 'markdown') body = <MarkdownView content={file.content} />;
  else if (ext === 'json') body = <JsonTree content={file.content} />;
  else body = <CsvTable content={file.content} ext={ext} />;

  return (
    <>
      <div className="viewer-toolbar">
        <div className="segmented">
          <button className={mode === 'render' ? 'active' : ''} disabled={!renderable} onClick={() => setMode('render')}>Rendered</button>
          <button className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>Raw</button>
          <button disabled title="Editing is coming soon">Edit</button>
        </div>
        <span className="muted ellipsis" style={{ flex: 1, fontSize: 12 }} title={path}>{path}</span>
        {file && <span className="muted" style={{ fontSize: 11 }}>{formatBytes(file.content.length)}{file.truncated ? ' (truncated)' : ''}</span>}
        <button className="btn sm" onClick={() => requestRead(path, true)}>Refresh</button>
        <button className="btn sm" onClick={() => void window.desktop.openInVsCode(path)}>VS Code</button>
      </div>
      <div className="viewer-main">{body}</div>
    </>
  );
}
