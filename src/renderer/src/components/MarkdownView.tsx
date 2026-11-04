import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Markdown file preview (file cards and viewer tabs): full GitHub-flavoured Markdown with inline HTML — tables,
 * <details>, <style> blocks, colour cards — as documents are written. The HTML is sanitized (no scripts, no on*
 * handlers, no forms) and drawn in a shadow root, so a document's own <style> stays inside it and never restyles
 * the app. Links open in the system browser. The base styles use :where() so a document's own rules win.
 */
const BASE_CSS = `
:host { display: block; background: var(--panel); min-height: 100%; }
.md { padding: 16px 26px; line-height: 1.6; font-size: 14px; color: var(--text); font-family: var(--font); }
:where(.md) h1, :where(.md) h2, :where(.md) h3, :where(.md) h4 { margin: 18px 0 8px; font-weight: 600; line-height: 1.3; }
:where(.md) h1 { font-size: 22px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
:where(.md) h2 { font-size: 18px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
:where(.md) h3 { font-size: 15px; }
:where(.md) p { margin: 8px 0; }
:where(.md) pre { background: var(--panel); border: 1px solid var(--border); border-radius: 5px; padding: 10px 12px; overflow: auto; font-size: 12px; font-family: var(--mono); }
:where(.md) code { color: var(--md-code); background: var(--panel2); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; font-family: var(--mono); }
:where(.md) pre code { color: inherit; background: none; padding: 0; }
:where(.md) ul, :where(.md) ol { padding-left: 24px; margin: 6px 0; }
:where(.md) li > ul, :where(.md) li > ol { margin: 2px 0; }
:where(.md) blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--border); }
:where(.md) table { border-collapse: collapse; margin: 8px 0; }
:where(.md) th, :where(.md) td { border: 1px solid var(--border); padding: 4px 10px; text-align: left; vertical-align: top; }
:where(.md) th { background: var(--panel2); }
:where(.md) a { color: var(--accent); text-decoration: none; }
:where(.md) a:hover { text-decoration: underline; }
:where(.md) hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }
:where(.md) img { max-width: 100%; }
:where(.md) details { margin: 6px 0; }
:where(.md) summary { cursor: pointer; }
:where(.md) input[type=checkbox] { margin-right: 6px; }
/* A document with its own <style> (doc-standard and the like) is written with fixed colours for a light page: dark
   headings on pale bands, white table cells. In the dark theme it is drawn as that light page, then inverted (hue kept)
   so every part is dark and readable together; pictures are turned back. */
.md.paper { --text: #1f2328; --panel: #fff; --panel2: #f3f4f6; --border: #d0d7de; --md-code: #562800; --accent: #0969da;
  /* the page colour is chosen so that, once inverted, it equals the dark panel (#282c34) */
  background: #e3e8f2; color: #1f2328; min-height: 100vh; filter: invert(0.9) hue-rotate(180deg); }
.md.paper img, .md.paper svg, .md.paper video, .md.paper canvas { filter: invert(1) hue-rotate(180deg); }
`;

marked.setOptions({ gfm: true, breaks: false });

// Inputs stay only as checkboxes / radios: GFM task lists and the CSS-only expand/collapse controls documents use.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName !== 'INPUT') return;
  const type = (node.getAttribute('type') || '').toLowerCase();
  if (type !== 'checkbox' && type !== 'radio') node.remove();
});

/**
 * The document's own <style> blocks, taken out before sanitizing: DOMPurify drops a <style> whose text contains
 * "<" (a CSS comment like "<a id> anchors …" is enough). They go back in as plain text, so they cannot add markup.
 */
function splitStyles(html: string): { html: string; css: string[] } {
  const css: string[] = [];
  const rest = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, body: string) => {
    css.push(body.replace(/\/\*[\s\S]*?\*\//g, ''));
    return '';
  });
  return { html: rest, css };
}

function render(md: string): { html: string; css: string[] } {
  const { html, css } = splitStyles(marked.parse(md, { async: false }) as string);
  // DOMPurify's default URI check (no javascript:). A custom ALLOWED_URI_REGEXP would also be applied to plain
  // values like type="radio" or rowspan="2" and strip them. Links only open https anyway (click handler below).
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ['open', 'target'],
    // nothing that submits or embeds a page
    FORBID_TAGS: ['form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed']
  });
  return { html: clean, css };
}

/** The app is in its dark theme (html[data-theme]); follows a change while the document is open. */
function useDark(): boolean {
  const read = (): boolean => document.documentElement.getAttribute('data-theme') === 'dark';
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function MarkdownView({ content }: { content: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const dark = useDark();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    const { html, css } = render(content);
    // a styled document keeps its light look; in the dark theme it is inverted as a whole (see .paper)
    root.innerHTML = `<style>${BASE_CSS}</style><div class="md${dark && css.length ? ' paper' : ''}">${html}</div>`;
    for (const text of css) {
      const style = document.createElement('style');
      style.textContent = text;
      root.appendChild(style);
    }
    // links: #anchors scroll inside the document, web links open in the system browser
    const onClick = (e: Event): void => {
      const a = (e.target as HTMLElement).closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        const target = root.getElementById(decodeURIComponent(href.slice(1)));
        if (target) target.scrollIntoView({ block: 'start' });
      } else if (/^https?:/i.test(href)) void window.desktop.openUrl(href);
      e.preventDefault();
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [content, dark]);

  return <div ref={host} className="md-host" />;
}
