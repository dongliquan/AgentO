import { useState } from 'react';
import { copyText } from '@/lib/search';

/** Search field at the top of a right-panel tab: filters as you type, shows the match count, Esc clears. */
export function SearchBox({ value, onChange, count, placeholder, autoFocus, onClose }: { value: string; onChange: (v: string) => void; count?: number; placeholder: string; autoFocus?: boolean; onClose?: () => void }): JSX.Element {
  return (
    <div className="rp-search">
      <span className="rp-search-icon">⌕</span>
      <input
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Esc clears; on an empty field it closes a collapsible search (onClose)
          if (e.key === 'Escape') {
            if (value || !onClose) onChange('');
            else onClose();
          }
        }}
      />
      {value && count !== undefined && <span className="rp-search-count">{count}</span>}
      {value && (
        <button className="rp-search-clear" onClick={() => onChange('')} title="Clear (Esc)">
          ×
        </button>
      )}
    </div>
  );
}

/** Small copy button; shows "Copied" for a moment. Stops the click so the item under it does not also open. */
export function CopyButton({ text, title = 'Copy' }: { text: string | (() => string); title?: string }): JSX.Element {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`copy-btn ${done ? 'done' : ''}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(typeof text === 'function' ? text() : text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? 'Copied' : '⧉'}
    </button>
  );
}
