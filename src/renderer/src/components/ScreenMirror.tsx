import { useEffect, useState } from 'react';
import type { Session } from '@shared/protocol';
import { useBuffer } from '@/lib/buffers';
import { screenLines } from '@/lib/screen';

/**
 * Screens of the CLI that are not part of the conversation (Claude Code's /plugin, /model and /context menus, setup
 * dialogs): they leave nothing in the transcript, so the chat would be empty while the terminal shows the menu. A menu
 * is told by its key hints on the last screen.
 */
const MENU_RE = /Esc to (?:cancel|close|exit|go back)|Enter to (?:select|add|confirm|continue|details|apply|toggle)|to navigate|Space to toggle|Type to search|(?<!shift\+)Tab to (?:switch|cycle)|←\/→|press Esc/i;

/** The lines of the terminal's screen when it shows such a menu, otherwise null. Reads only when `enabled`. */
export function useMenuScreen(s: Session, enabled: boolean): string[] | null {
  const raw = useBuffer(s.id, enabled);
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled || !raw) {
      setLines(null);
      return;
    }
    let dead = false;
    const rows = Math.max(10, s.rows || 30);
    // debounced: a menu redraws many times a second
    const timer = setTimeout(() => {
      void screenLines(raw.slice(-60000), s.cols || 100, rows).then((all) => {
        if (dead) return;
        const screen = all.slice(-rows).map((l) => l.replace(/\s+$/, ''));
        while (screen.length && screen[screen.length - 1] === '') screen.pop();
        while (screen.length && screen[0] === '') screen.shift();
        setLines(screen.length && MENU_RE.test(screen.slice(-12).join('\n')) ? screen : null);
      });
    }, 250);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [raw, enabled, s.cols, s.rows]);
  return lines;
}

/** The terminal's screen as read-only text in the chat, with the way on to the terminal to use it. */
export function ScreenMirror({ lines, onShowTerminal }: { lines: string[]; onShowTerminal: () => void }): JSX.Element {
  return (
    <div className="screen-mirror">
      <div className="screen-mirror-head">
        <span>Terminal screen · read-only</span>
        <span className="grow" />
        <button className="btn sm" onClick={onShowTerminal} title="This screen is driven with the keys: continue in the Terminal">
          Continue in Terminal
        </button>
      </div>
      <pre className="screen-mirror-body">{lines.join('\n')}</pre>
    </div>
  );
}
