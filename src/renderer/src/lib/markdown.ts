/**
 * Tiny dependency-free Markdown -> HTML renderer.
 * Supports: headings, paragraphs, fenced code, inline code, bold/italic/strike, links,
 * ordered/unordered lists (one nesting level via indentation), tables, blockquotes, hr.
 * All text is HTML-escaped; only our own tags are emitted.
 */

import { isFileRef } from './fileRefPattern';

const decode = (u: string): string => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(src: string): string {
  // Protect inline code first.
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_m, c: string) => {
    // a file name or path: clickable (open it, or show it in the sidebar)
    codes.push(isFileRef(c) ? `<code class="file-ref" data-file="${escapeHtml(c.trim())}" title="Open · show in sidebar">${escapeHtml(c)}</code>` : `<code>${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<span class="muted">[Image: $1]</span>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => {
    // a link to a local file ("/C:/x/y.vue", "C:\x\y.md", "src/a.ts"): the same clickable file reference
    const local = u.replace(/^\/(?=[A-Za-z]:)/, '').replace(/#L\d+.*$/, '');
    if (!/^(https?:|mailto:|#)/i.test(u) && isFileRef(decode(local))) return `<a class="file-ref" data-file="${escapeHtml(decode(local))}" title="Open · show in sidebar">${t}</a>`;
    const safe = /^(https?:|mailto:|#)/i.test(u) ? u : '#';
    return `<a href="${safe}" target="_blank" rel="noreferrer">${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]);
  return s;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const isTableRow = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l);
  // the delimiter row: cells of hyphens, one is enough (":-:" is a centred column), with colons for alignment
  const isSep = (l: string): boolean => l.includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // fenced code
    const fence = line.match(/^\s*(```|~~~)\s*(\w+)?/);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] ?? '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // heading
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // hr
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // table
    if (isTableRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const cells = (l: string): string[] => splitCells(l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, ''));
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      );
      continue;
    }

    // lists
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const baseIndent = li[1].length;
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        const ind = m[1].length;
        if (ind < baseIndent) break;
        if (ind > baseIndent) {
          // nested list: collect and recurse
          const sub: string[] = [];
          while (i < lines.length) {
            const mm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+/);
            if (!mm || mm[1].length <= baseIndent) break;
            sub.push(lines[i]);
            i++;
          }
          if (items.length > 0) {
            items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `${renderMarkdown(sub.join('\n'))}</li>`);
          } else {
            items.push(`<li>${renderMarkdown(sub.join('\n'))}</li>`);
          }
          continue;
        }
        let text = m[3];
        const task = text.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          text = `<input type="checkbox" disabled ${task[1] !== ' ' ? 'checked' : ''}/> ${task[2]}`;
          items.push(`<li>${text.replace(/^(<input[^>]*>) (.*)$/, (_a, cb: string, t: string) => `${cb} ${inline(t)}`)}</li>`);
        } else {
          items.push(`<li>${inline(text)}</li>`);
        }
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // paragraph
    const buf: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !/^\s{0,3}#{1,6}\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${buf.map((l) => inline(l)).join('<br />')}</p>`);
  }
  return out.join('\n');
}

/**
 * A table row's cells: split on `|`, but not on an escaped `\|` (GFM) or a `|` inside an inline code span — so
 * `a \|\| b` or `` `x || y` `` stay in one cell. An escaped pipe shows as a plain `|`.
 */
function splitCells(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let code = 0; // length of the backtick run that opened the current code span
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!;
    if (ch === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '`') {
      let n = 1;
      while (row[i + n] === '`') n++;
      if (!code) code = n;
      else if (n === code) code = 0;
      cur += row.slice(i, i + n);
      i += n - 1;
      continue;
    }
    if (ch === '|' && !code) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
