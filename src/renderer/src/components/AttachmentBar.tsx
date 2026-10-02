import { useRef } from 'react';
import type { Attachment } from '@/lib/attachments';

/** Thumbnails of a message box's images (× to drop one), and a hidden picker opened by AttachButton. */
export function AttachmentBar({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="attach-bar">
      {items.map((a) => (
        <div key={a.id} className={`attach-chip ${a.error ? 'error' : a.path ? '' : 'saving'}`} title={a.error ?? a.path ?? 'Saving…'}>
          <img src={a.url} alt={a.name} />
          <button className="attach-x" onClick={() => onRemove(a.id)} title="Remove">×</button>
        </div>
      ))}
    </div>
  );
}

/** Paperclip button: pick image files. */
export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="icon-btn attach-btn" disabled={disabled} title="Attach images (or paste / drop them)" onClick={() => input.current?.click()}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.5 4.5 5.4 9.6a1.5 1.5 0 0 0 2.1 2.1l5.6-5.6a3 3 0 0 0-4.2-4.2L3.3 7.5a4.5 4.5 0 0 0 6.4 6.4l4.1-4.1" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/')));
          e.target.value = '';
        }}
      />
    </>
  );
}
