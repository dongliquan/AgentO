import type { Attachment } from '@/lib/attachments';
import { openFile } from '@/lib/openfile';

/** Thumbnails of a message box's images (× to drop one) (images come in by paste or drop). */
export function AttachmentBar({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="attach-bar">
      {items.map((a) => (
        <div key={a.id} className={`attach-chip ${a.error ? 'error' : a.path ? '' : 'saving'}`} title={a.error ?? (a.path ? `${a.path}\nClick to view` : 'Saving…')}>
          <img
            src={a.url}
            alt={a.name}
            style={a.path ? { cursor: 'pointer' } : undefined}
            onClick={() => a.path && openFile(a.path, '')}
          />
          <button className="attach-x" onClick={() => onRemove(a.id)} title="Remove">×</button>
        </div>
      ))}
    </div>
  );
}
