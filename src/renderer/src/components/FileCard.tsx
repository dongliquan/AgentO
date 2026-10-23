import { memo, useEffect } from 'react';
import type React from 'react';
import { useStore, type FileCard as FileCardModel } from '@/store';
import { requestRead } from '@/client';
import { basename, extname } from '@/lib/format';
import { FileIcon } from './FileIcon';
import { startDrag } from '@/lib/drag';
import { CodeView } from './CodeView';
import { languageOf } from '@/lib/highlight';
import { MarkdownView } from './MarkdownView';
import { JsonTree } from './JsonTree';
import { CsvTable } from './CsvTable';

const MIN_W = 260;
const MIN_H = 160;

function FileCardImpl({ card, selected }: { card: FileCardModel; selected: boolean }): JSX.Element {
  const update = useStore((s) => s.updateFileCard);
  const close = useStore((s) => s.closeFileCard);
  const selectCard = useStore((s) => s.selectFileCard);
  const openViewerTab = useStore((s) => s.openViewerTab);
  const file = useStore((s) => s.fileContents.get(card.path));
  const git = useStore((s) => {
    const list = s.changed.get(card.cwd);
    return list?.find((e) => e.path === card.path)?.gitStatus;
  });

  useEffect(() => {
    requestRead(card.path);
  }, [card.path]);

  const onHeaderDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return;
    const ox = card.x;
    const oy = card.y;
    startDrag(e, {
      scale: () => useStore.getState().zoom,
      onMove: (dx, dy) => update(card.id, { x: Math.round(ox + dx), y: Math.round(oy + dy) })
    });
  };
  const onResizeDown = (e: React.PointerEvent): void => {
    e.stopPropagation();
    const ow = card.w;
    const oh = card.h;
    startDrag(e, {
      scale: () => useStore.getState().zoom,
      threshold: 0,
      onMove: (dx, dy) => update(card.id, { w: Math.max(MIN_W, Math.round(ow + dx)), h: Math.max(MIN_H, Math.round(oh + dy)) })
    });
  };

  const name = basename(card.path);
  const ext = extname(name);
  const renderable = ext === 'md' || ext === 'markdown' || ext === 'json' || ext === 'csv' || ext === 'tsv';
  return (
    <div
      className={`card file ${selected ? 'selected' : ''}`}
      style={{ left: card.x, top: card.y, width: card.w, height: card.h, zIndex: selected ? 10 : 2 }}
      onPointerDownCapture={() => {
        if (!selected) selectCard(card.id);
      }}
    >
      <div className="card-header" onPointerDown={onHeaderDown}>
        <FileIcon name={name} />
        <span className="title ellipsis" title={card.path}>{name}</span>
        {git && <span className={`git-letter ${git}`}>{git}</span>}
        <span style={{ flex: 1 }} />
        <div className="segmented">
          {renderable && <button className={card.mode === 'view' ? 'active' : ''} onClick={() => update(card.id, { mode: 'view' })}>View</button>}
          <button className={card.mode === 'raw' ? 'active' : ''} onClick={() => update(card.id, { mode: 'raw' })}>Raw</button>
          <button className={card.mode === 'diff' ? 'active' : ''} onClick={() => update(card.id, { mode: 'diff' })}>diff</button>
        </div>
        <button className="card-menu-btn" title="Close" onClick={() => close(card.id)}>×</button>
      </div>
      <div className="path ellipsis" title={card.path}>{card.path}</div>
      <div className="card-body" onWheel={(e) => { if (!e.ctrlKey) e.stopPropagation(); }}>
        {card.mode === 'diff' && (
          // TODO: request a real `git diff` once the daemon exposes it; for now show the raw file.
          <div className="diff-note">diff: git diff via daemon is not yet supported; showing raw content.</div>
        )}
        {!file ? (
          <div className="tree-empty">Loading…</div>
        ) : (
          <>
            {file.truncated && <div className="diff-note">File is truncated.</div>}
            {card.mode === 'view' && renderable ? (
              ext === 'md' || ext === 'markdown' ? (
                <MarkdownView content={file.content} />
              ) : ext === 'json' ? (
                <JsonTree content={file.content} />
              ) : (
                <CsvTable content={file.content} ext={ext} />
              )
            ) : (
              <CodeView content={file.content} maxLines={2000} lang={languageOf(card.path)} />
            )}
          </>
        )}
      </div>
      <div className="card-footer">
        <span className="muted">{extname(name).toUpperCase() || 'File'}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => openViewerTab(card.path)}>Open in Tab</button>
        <button className="btn sm" onClick={() => void window.desktop.openInVsCode(card.path)}>VS Code</button>
      </div>
      <div className="resize-handle" onPointerDown={onResizeDown} />
    </div>
  );
}

/** Re-renders only when its own props change — not on every pan / zoom frame of the Ground. */
export const FileCard = memo(FileCardImpl);
