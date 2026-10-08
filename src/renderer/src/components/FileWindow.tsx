import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Viewer } from './ViewerTabs';
import { kbd } from '@/lib/keys';

/** A viewer window's whole page: one file, rendered or raw, read through the daemon like the viewer tabs. */
export function FileWindow({ path }: { path: string }): JSX.Element {
  const connected = useStore((s) => s.connected);
  return (
    <div className="viewer file-window">
      <FindBar />
      {connected ? <Viewer path={path} /> : <div className="tree-empty">Connecting to daemon…</div>}
    </div>
  );
}

/**
 * Ctrl+F: find in the file (Chromium find-in-page, so the rendered Markdown, code and tables alike). Enter / F3 next,
 * Shift+Enter / Shift+F3 previous, Esc closes.
 */
function FindBar(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ matches: number; active: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const last = useRef('');

  useEffect(() => window.desktopEvents?.onFindResult?.((r) => setResult(r)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => input.current?.select(), 0);
      } else if (e.key === 'F3' && last.current) {
        e.preventDefault();
        window.desktop.find(last.current, !e.shiftKey, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const search = (value: string, forward = true): void => {
    const again = value === last.current;
    last.current = value;
    if (!value) {
      window.desktop.stopFind();
      setResult(null);
      return;
    }
    window.desktop.find(value, forward, again);
  };
  const close = (): void => {
    setOpen(false);
    last.current = '';
    setResult(null);
    window.desktop.stopFind();
  };

  if (!open) return null;
  return (
    <div className="find-bar" role="search">
      <input
        ref={input}
        value={text}
        placeholder={kbd('Find in file (Enter next, Shift+Enter previous)')}
        autoFocus
        onChange={(e) => {
          setText(e.target.value);
          search(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            search(text, !e.shiftKey);
          } else if (e.key === 'Escape') close();
        }}
      />
      <span className="find-count">{result && text ? (result.matches ? `${result.active}/${result.matches}` : 'No results') : ''}</span>
      <button className="icon-btn" title="Previous (Shift+Enter)" disabled={!text} onClick={() => search(text, false)}>↑</button>
      <button className="icon-btn" title="Next (Enter)" disabled={!text} onClick={() => search(text, true)}>↓</button>
      <button className="icon-btn" title="Close (Esc)" onClick={close}>×</button>
    </div>
  );
}
