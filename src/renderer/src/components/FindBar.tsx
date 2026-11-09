import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { kbd } from '@/lib/keys';

/** Whether the find bar is open (Ctrl+F / Edit › Find). */
export const useFindBar = create<{ open: boolean; show: () => void }>((set) => ({ open: false, show: () => set({ open: true }) }));

/**
 * Ctrl+F: find on the page (Chromium find-in-page — a file's rendered Markdown, code and tables, or the main window's chats,
 * lists and cards). Enter / F3 next,
 * Shift+Enter / Shift+F3 previous, Esc closes.
 */
export function FindBar(): JSX.Element | null {
  const open = useFindBar((s) => s.open);
  const setOpen = (v: boolean): void => useFindBar.setState({ open: v });
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ matches: number; active: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const last = useRef('');
  useEffect(() => {
    if (open) setTimeout(() => input.current?.select(), 0);
  }, [open]);
  /** Korean / Japanese / Chinese input in progress: no search until the syllable is done */
  const composing = useRef(false);

  // find-in-page takes the keyboard focus from the box: give it back, so typing (and an input method) carries on
  useEffect(
    () =>
      window.desktopEvents?.onFindResult?.((r) => {
        setResult(r);
        if (document.activeElement !== input.current) input.current?.focus();
      }),
    []
  );
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
    // find-in-page grabs the keyboard focus: take it back at once so the next keys are not lost
    for (const ms of [0, 30, 120]) setTimeout(() => input.current && document.activeElement !== input.current && input.current.focus(), ms);
  };
  /** typing searches after a short pause: a find on every key would steal the focus between letters */
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const searchSoon = (value: string): void => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(value), value ? 250 : 0);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = (): void => {
    clearTimeout(timer.current);
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
        placeholder={kbd('Find (Enter next, Shift+Enter previous)')}
        autoFocus
        onChange={(e) => {
          setText(e.target.value);
          if (!composing.current) searchSoon(e.target.value);
        }}
        onCompositionStart={() => {
          composing.current = true;
          clearTimeout(timer.current);
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          searchSoon(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(timer.current);
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
