import { memo, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useStore } from '@/store';
import { send } from '@/client';
import { siteHost, siteOf, useWebPages, WEB_PARTITION, WEB_SITES, WEB_ZOOM, type WebPage } from '@/lib/webpages';
import { closedSessionIds } from '@/lib/closedIds';
import { displayTitle, statusClass } from '@/lib/format';

/** The bits of Electron's <webview> element a web page uses. */
interface WebviewEl extends HTMLElement {
  getURL(): string;
  setZoomFactor(f: number): void;
  canGoBack(): boolean;
  goBack(): void;
  reload(): void;
  executeJavaScript(code: string): Promise<unknown>;
}

/**
 * One web page with its bar: back, reload, "→ Session" (the text selected on the page to a session), open in the
 * browser. It stays mounted while hidden, so switching tabs or sites never reloads it.
 */
const Page = memo(function Page({ page, visible }: { page: WebPage; visible: boolean }): JSX.Element {
  const update = useWebPages((s) => s.update);
  const ref = useRef<WebviewEl>(null);
  const [canBack, setCanBack] = useState(false);
  const [pick, setPick] = useState<{ text: string } | null>(null);
  // the first address only: afterwards the page goes where the user goes
  const [src] = useState(page.url);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const onNav = (): void => {
      setCanBack(wv.canGoBack());
      const url = wv.getURL();
      if (url.startsWith('https://')) update(page.id, { url });
    };
    const onTitle = (e: Event): void => {
      const t = (e as Event & { title?: string }).title;
      if (t) update(page.id, { title: t });
    };
    // the site's own look, with AgentO's style laid over it where the site entry has one (fonts)
    const onReady = (): void => {
      wv.setZoomFactor(useWebPages.getState().pages.find((p) => p.id === page.id)?.zoom ?? WEB_ZOOM);
      const css = siteOf(wv.getURL())?.css;
      if (css) void (wv as WebviewEl & { insertCSS(c: string): Promise<string> }).insertCSS(css);
    };
    // the page's icon for its chip
    const onIcon = (e: Event): void => {
      const url = (e as Event & { favicons?: string[] }).favicons?.find((f) => f.startsWith('https://'));
      if (!url) return;
      void window.desktop.webFavicon(url).then((icon) => {
        if (icon && icon !== useWebPages.getState().pages.find((p) => p.id === page.id)?.icon) update(page.id, { icon });
      });
    };
    wv.addEventListener('page-favicon-updated', onIcon);
    wv.addEventListener('dom-ready', onReady);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('page-title-updated', onTitle);
    return () => {
      wv.removeEventListener('dom-ready', onReady);
      wv.removeEventListener('page-favicon-updated', onIcon);
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
      wv.removeEventListener('page-title-updated', onTitle);
    };
  }, [page.id, update]);

  const zoomBy = (d: number): void => {
    const z = Math.round(Math.min(1.5, Math.max(0.5, (page.zoom ?? WEB_ZOOM) + d)) * 100) / 100;
    ref.current?.setZoomFactor(z);
    update(page.id, { zoom: z });
  };

  const sendSelection = async (): Promise<void> => {
    const text = String((await ref.current?.executeJavaScript('window.getSelection ? String(window.getSelection()) : ""')) ?? '').trim();
    if (!text) {
      window.alert('Select some text on the page first, then press → Session.');
      return;
    }
    setPick({ text });
  };

  return (
    <div className="web-page" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="web-bar">
        <span className="title ellipsis" title={page.url}>{page.title || siteHost(page.url)}</span>
        <span style={{ flex: 1 }} />
        <button className="card-menu-btn web-zoom" title="Smaller text" onClick={() => zoomBy(-0.05)}>A−</button>
        <span className="web-zoom-pct" title="Text size">{Math.round((page.zoom ?? WEB_ZOOM) * 100)}%</span>
        <button className="card-menu-btn web-zoom" title="Larger text" onClick={() => zoomBy(0.05)}>A+</button>
        <button className="card-menu-btn" disabled={!canBack} title="Back" onClick={() => ref.current?.goBack()}>‹</button>
        <button className="card-menu-btn" title="Reload" onClick={() => ref.current?.reload()}>↻</button>
        <button className="btn sm ghost" title="Send the text selected on the page to a session" onClick={() => void sendSelection()}>→ Session</button>
        <button className="card-menu-btn" title="Open in the browser" onClick={() => void window.desktop.openUrl(ref.current?.getURL() || page.url)}>↗</button>
      </div>
      <div className="web-body">
        {/* allowpopups is a plain attribute for Electron (sign-in pop-ups); React types it as boolean */}
        <webview ref={ref as unknown as React.Ref<HTMLWebViewElement>} src={src} partition={WEB_PARTITION} {...({ allowpopups: 'true' } as object)} />
      </div>
      {pick && <SessionPick text={pick.text} source={siteHost(page.url)} onClose={() => setPick(null)} />}
    </div>
  );
});

/**
 * Right panel › Web: the user's web pages (Gemini, ChatGPT …) as chips, the chosen one below. Always mounted
 * (hidden off the Web tab), so a page and its conversation survive switching tabs.
 */
export function WebPanel({ visible }: { visible: boolean }): JSX.Element {
  const pages = useWebPages((s) => s.pages);
  const active = useWebPages((s) => s.active);
  const { open, show, close } = useWebPages.getState();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const missing = WEB_SITES.filter((w) => !pages.some((p) => siteOf(p.url) === w));
  const go = (): void => {
    const u = url.trim().replace(/^(?!https?:\/\/)/, 'https://');
    if (/^https:\/\/[^\s]+\.[^\s]+/.test(u)) {
      open(u, '');
      setUrl('');
      setAdding(false);
    }
  };
  return (
    <div className="web-panel" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="web-sites">
        {pages.map((p) => (
          <span key={p.id} className={`web-site ${active === p.id ? 'on' : ''}`} onClick={() => show(p.id)} title={p.url}>
            {p.icon ? <img className="web-site-ico" src={p.icon} alt="" /> : <span className="web-site-ico">🌐</span>}
            {siteOf(p.url)?.label ?? siteHost(p.url)}
            <button className="web-site-x" title="Close" onClick={(e) => { e.stopPropagation(); close(p.id); }}>×</button>
          </span>
        ))}
        <button className={`web-site add ${adding ? 'on' : ''}`} onClick={() => setAdding(!adding)} title="Open a site">＋</button>
      </div>
      {(adding || pages.length === 0) && (
        <div className="web-add">
          {missing.map((w) => (
            <button key={w.url} className="btn sm" onClick={() => { open(w.url, w.label); setAdding(false); }}>
              {w.label}
            </button>
          ))}
          <input
            value={url}
            placeholder="Other address — Enter"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          {pages.length === 0 && <div className="muted web-add-hint">Your own sign-in and subscription; not part of any project.</div>}
        </div>
      )}
      {pages.map((p) => (
        <Page key={p.id} page={p} visible={p.id === active} />
      ))}
    </div>
  );
}

/** Choose the session that gets the selected text (it is woken if stopped). */
function SessionPick({ text, source, onClose }: { text: string; source: string; onClose: () => void }): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const closed = closedSessionIds(sessions.values(), projects);
  const list = [...sessions.values()].filter((s) => !closed.has(s.id)).sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div className="web-pick">
      <div className="web-pick-head">
        <span>Send the selection ({text.length} chars) to</span>
        <span className="grow" />
        <button className="card-menu-btn" onClick={onClose}>×</button>
      </div>
      <div className="web-pick-list">
        {list.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              send({ type: 'session.message', id: s.id, text: `[From ${source}]\n${text}` });
              onClose();
            }}
          >
            <span className={`status-dot ${statusClass(s)}`} />
            <span className="ellipsis">{displayTitle(s)}</span>
          </button>
        ))}
        {list.length === 0 && <div className="muted">No sessions.</div>}
      </div>
    </div>
  );
}
