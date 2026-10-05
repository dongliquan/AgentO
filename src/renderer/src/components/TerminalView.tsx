import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { send } from '@/client';
import { onTerm } from '@/lib/termbus';
import { isAppShortcut } from '@/lib/keys';
import { TERMINAL_THEME } from '@/lib/theme';
import { getBuffer } from '@/lib/buffers';


interface Props {
  sessionId: string;
  /** any value whose change should trigger a re-fit (e.g. card w/h) */
  fitKey?: string | number;
  autoFocus?: boolean;
}

export function TerminalView({ sessionId, fitKey, autoFocus }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastSize = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: '"D2Coding", "Microsoft YaHei", Consolas, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: false
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && isAppShortcut(e)) return false;
      return true;
    });

    // instant replay from store buffer
    const buf = getBuffer(sessionId);
    if (buf) term.write(buf);

    const doFit = (): void => {
      try {
        fit.fit();
      } catch {
        return;
      }
      const { cols, rows } = term;
      if (cols > 0 && rows > 0 && (cols !== lastSize.current.cols || rows !== lastSize.current.rows)) {
        lastSize.current = { cols, rows };
        send({ type: 'session.resize', id: sessionId, cols, rows });
      }
    };
    requestAnimationFrame(doFit);

    send({ type: 'session.attach', id: sessionId });

    const offBus = onTerm(sessionId, (ev) => {
      if (ev.kind === 'data') term.write(ev.data);
      else {
        term.reset();
        term.write(ev.data);
      }
    });
    const dataDisp = term.onData((d) => send({ type: 'session.input', id: sessionId, data: d }));
    const binDisp = term.onBinary((d) => send({ type: 'session.input', id: sessionId, data: d }));

    const ro = new ResizeObserver(() => doFit());
    ro.observe(el);

    const onFocusEvt = (e: Event): void => {
      const d = (e as CustomEvent<{ sessionId: string }>).detail;
      if (d?.sessionId === sessionId) term.focus();
    };
    window.addEventListener('asm:focus-terminal', onFocusEvt);
    if (autoFocus) setTimeout(() => term.focus(), 50);

    return () => {
      window.removeEventListener('asm:focus-terminal', onFocusEvt);
      ro.disconnect();
      offBus();
      dataDisp.dispose();
      binDisp.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const t = setTimeout(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const { cols, rows } = term;
      if (cols > 0 && rows > 0 && (cols !== lastSize.current.cols || rows !== lastSize.current.rows)) {
        lastSize.current = { cols, rows };
        send({ type: 'session.resize', id: sessionId, cols, rows });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [fitKey, sessionId]);

  return (
    <div
      className="term-wrap"
      ref={ref}
      onPointerDown={(e) => {
        if (e.button === 0) e.stopPropagation();
      }}
      onWheel={(e) => {
        if (!e.ctrlKey) e.stopPropagation();
      }}
    />
  );
}
