import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import groovy from 'highlight.js/lib/languages/groovy';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGS = { bash, cpp, csharp, css, diff, dockerfile, go, groovy, ini, java, javascript, json, kotlin, markdown, powershell, python, rust, scss, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

/** file extension (or whole name) → highlight.js language */
const BY_EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  vue: 'xml', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', jsp: 'xml',
  css: 'css', scss: 'scss', less: 'scss',
  java: 'java', kt: 'kotlin', kts: 'kotlin', groovy: 'groovy', gradle: 'groovy',
  py: 'python', go: 'go', rs: 'rust', cs: 'csharp', c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', json: 'json', jsonc: 'json', json5: 'json',
  ini: 'ini', toml: 'ini', properties: 'ini', cfg: 'ini', conf: 'ini', env: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', psm1: 'powershell', bat: 'bash', cmd: 'bash',
  md: 'markdown', markdown: 'markdown', diff: 'diff', patch: 'diff'
};
const BY_NAME: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'bash', jenkinsfile: 'groovy' };

export function languageOf(path: string): string | undefined {
  const name = path.replace(/^.*[\\/]/, '').toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return BY_EXT[ext];
}

/** Larger files stay plain: highlighting is synchronous and would stall the window. */
export const HIGHLIGHT_MAX = 400_000;

/** Highlighted HTML (escaped by highlight.js), or null when the language is unknown or the text too big. */
export function highlight(code: string, lang: string | undefined): string | null {
  if (!lang || code.length > HIGHLIGHT_MAX || !hljs.getLanguage(lang)) return null;
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
