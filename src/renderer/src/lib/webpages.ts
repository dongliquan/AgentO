import { create } from 'zustand';
import { useStore } from '@/store';
import { useDock } from '@/lib/dock';

/**
 * Web pages in the right panel's Web tab (Gemini, ChatGPT …) for the user's own use with a web / app
 * subscription — the manager's tool, not part of any project. Kept in this window only (not the daemon) and
 * remembered per viewer; each page keeps its own location.
 */
export interface WebPage {
  id: string;
  url: string;
  title: string;
  /** the site's icon as a data: URL (fetched by the main process, see agents.favicon) */
  icon?: string;
  /** page zoom (text size), default WEB_ZOOM */
  zoom?: number;
}

/** Web pages open a little smaller than the browser default: the panel is narrower than a browser window. */
export const WEB_ZOOM = 0.85;

/** The sign-in for every web page lives in this partition (see src/main/webviews.ts). */
export const WEB_PARTITION = 'persist:agento-web';

/**
 * hosts: where the site may send its page (a site may land on another host of its own).
 * css: a style laid over the site's own (only looks — e.g. the Chinese text in Microsoft YaHei).
 */
export const WEB_SITES: { label: string; url: string; hosts: string[]; css?: string }[] = [
  { label: 'Gemini', url: 'https://gemini.google.com/app', hosts: ['gemini.google.com'] },
  { label: 'ChatGPT', url: 'https://chatgpt.com/', hosts: ['chatgpt.com', 'chat.openai.com'] }
];

/** The known site a page belongs to (by any of its hosts). */
export function siteOf(url: string): (typeof WEB_SITES)[number] | undefined {
  const h = host(url);
  return WEB_SITES.find((w) => w.hosts.includes(h));
}

/** Same site: the same known site, or else the same host. */
function sameSite(a: string, b: string): boolean {
  const sa = siteOf(a);
  return sa ? sa === siteOf(b) : host(a) === host(b);
}

const KEY = 'asm.webPages';

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function siteHost(url: string): string {
  return host(url);
}

function load(): { pages: WebPage[]; active: string | null } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as { pages?: WebPage[]; active?: string | null };
    const pages = (v.pages ?? []).filter((p) => typeof p.url === 'string' && p.url.startsWith('https://') && !/(^|\.)baidu\.com\//.test(p.url.replace(/^https:\/\//, '')));
    return { pages, active: pages.some((p) => p.id === v.active) ? v.active ?? null : pages[0]?.id ?? null };
  } catch {
    return { pages: [], active: null };
  }
}

function save(pages: WebPage[], active: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ pages, active }));
  } catch {
    /* storage unavailable */
  }
}

interface WebPagesState {
  pages: WebPage[];
  active: string | null;

  /** open a site in the Web tab (an open page of the same site is shown instead of a second one) */
  open(url: string, title: string): void;
  show(id: string): void;
  update(id: string, patch: Partial<WebPage>): void;
  close(id: string): void;
}

export const useWebPages = create<WebPagesState>((set, get) => ({
  ...load(),
  open: (url, title) => {
    const same = get().pages.find((p) => sameSite(p.url, url));
    let pages = get().pages;
    let active: string;
    if (same) active = same.id;
    else {
      active = `web-${Date.now().toString(36)}`;
      pages = [...pages, { id: active, url, title }];
    }
    save(pages, active);
    set({ pages, active });
    // docked beside the panel it is on screen already; otherwise open the panel's Web tab
    if (!useDock.getState().docked.includes('web')) useStore.getState().setRightTab('web');
  },
  show: (id) => {
    save(get().pages, id);
    set({ active: id });
  },
  update: (id, patch) => {
    const pages = get().pages.map((p) => (p.id === id ? { ...p, ...patch } : p));
    save(pages, get().active);
    set({ pages });
  },
  close: (id) => {
    const pages = get().pages.filter((p) => p.id !== id);
    const active = get().active === id ? pages[pages.length - 1]?.id ?? null : get().active;
    save(pages, active);
    set({ pages, active });
  }
}));

/** Earlier web cards on the Ground (asm.webCards) become pages of the Web tab, once. */
(function migrate(): void {
  try {
    const old = JSON.parse(localStorage.getItem('asm.webCards') || 'null') as { url: string; title: string }[] | null;
    if (!old) return;
    localStorage.removeItem('asm.webCards');
    for (const c of old) if (c.url?.startsWith('https://') && !useWebPages.getState().pages.some((p) => sameSite(p.url, c.url))) {
      const pages = [...useWebPages.getState().pages, { id: `web-${Math.random().toString(36).slice(2, 9)}`, url: c.url, title: c.title }];
      save(pages, pages[0]!.id);
      useWebPages.setState({ pages, active: useWebPages.getState().active ?? pages[0]!.id });
    }
  } catch {
    /* storage unavailable */
  }
})();
