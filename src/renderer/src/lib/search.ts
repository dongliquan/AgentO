import { useLayoutEffect, type RefObject } from 'react';

/** Case-insensitive "contains" for the right-panel search boxes; an empty query matches everything. */
export function matches(q: string, ...texts: (string | undefined)[]): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return texts.some((t) => t !== undefined && t.toLowerCase().includes(n));
}

const HIGHLIGHT = 'agento-search';

/**
 * Marks every occurrence of the query inside `ref` with the CSS Custom Highlight API (styled by
 * `::highlight(agento-search)`), so rendered markdown is highlighted without touching its DOM. Re-run after each render
 * that may change the text (pass those values as deps).
 */
export function useHighlight(ref: RefObject<HTMLElement>, q: string, deps: unknown[]): void {
  useLayoutEffect(() => {
    const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
    const root = ref.current;
    const n = q.trim().toLowerCase();
    if (!registry) return;
    if (!root || !n) {
      registry.delete(HIGHLIGHT);
      return;
    }
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').toLowerCase();
      for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + n.length)) {
        const r = new Range();
        r.setStart(node, i);
        r.setEnd(node, i + n.length);
        ranges.push(r);
      }
    }
    registry.set(HIGHLIGHT, new Highlight(...ranges));
    return () => {
      registry.delete(HIGHLIGHT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ...deps]);
}

/** Copies text to the clipboard; falls back to a hidden textarea where the async API is unavailable. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** True while the user has text selected — a click that ends a selection should not also navigate. */
export function selecting(): boolean {
  return (window.getSelection()?.toString() ?? '').length > 0;
}
