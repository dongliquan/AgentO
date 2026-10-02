/**
 * Best-effort usage/quota information per agent.
 *
 * TODO: none of the CLIs expose a stable, documented local usage file. This module only
 * looks for a few plausible files and picks obvious fields when present; otherwise it
 * returns a '—' label so the UI can still render a row per agent.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageInfo } from '@shared/protocol';

function readJson(file: string): unknown {
  try {
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Look for common field names describing a "used / limit" or "utilization" pair. */
function extractRatio(obj: Record<string, unknown>): { ratio?: number; resetsAt?: number; label?: string } {
  const out: { ratio?: number; resetsAt?: number; label?: string } = {};
  const ratioKeys = ['utilization', 'ratio', 'percentUsed', 'percent_used', 'usedRatio'];
  for (const k of ratioKeys) {
    const v = num(obj[k]);
    if (v !== undefined) {
      out.ratio = v > 1 ? v / 100 : v;
      break;
    }
  }
  if (out.ratio === undefined) {
    const used = num(obj['used']) ?? num(obj['usedTokens']) ?? num(obj['tokensUsed']);
    const limit = num(obj['limit']) ?? num(obj['tokenLimit']) ?? num(obj['max']);
    if (used !== undefined && limit && limit > 0) out.ratio = Math.min(1, used / limit);
  }
  const reset = obj['resetsAt'] ?? obj['resetAt'] ?? obj['reset_at'] ?? obj['resets_at'];
  if (typeof reset === 'number') out.resetsAt = reset < 1e12 ? reset * 1000 : reset;
  else if (typeof reset === 'string') {
    const t = Date.parse(reset);
    if (!Number.isNaN(t)) out.resetsAt = t;
  }
  if (out.ratio !== undefined) out.label = `${Math.round(out.ratio * 100)}%`;
  return out;
}

/* ---------- Claude: 5-hour usage window computed from transcripts (ccusage-style) ---------- */

const WINDOW_MS = 5 * 3600_000;
interface Rec { ts: number; tokens: number; model?: string }
/** incremental per-file cache: bytes already parsed + records within the look-back horizon */
const tails = new Map<string, { offset: number; rest: string; recs: Rec[] }>();

function scanClaudeTranscripts(configDir: string, horizon: number): Rec[] {
  const root = path.join(configDir, 'projects');
  const out: Rec[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const d of dirs) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = path.join(root, d, f);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.mtimeMs < horizon) {
        tails.delete(full);
        continue;
      }
      let t = tails.get(full);
      if (!t || st.size < t.offset) {
        t = { offset: 0, rest: '', recs: [] };
        tails.set(full, t);
      }
      if (st.size > t.offset) {
        try {
          const fd = fs.openSync(full, 'r');
          const buf = Buffer.alloc(st.size - t.offset);
          fs.readSync(fd, buf, 0, buf.length, t.offset);
          fs.closeSync(fd);
          t.offset = st.size;
          const lines = (t.rest + buf.toString('utf8')).split('\n');
          t.rest = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.includes('"usage"')) continue;
            let o: unknown;
            try {
              o = JSON.parse(line);
            } catch {
              continue;
            }
            if (!isObj(o) || o['type'] !== 'assistant' || !isObj(o['message'])) continue;
            const m = o['message'];
            const u = m['usage'];
            if (!isObj(u)) continue;
            const ts = Date.parse(String(o['timestamp'] ?? ''));
            if (!ts) continue;
            const tokens = (num(u['input_tokens']) ?? 0) + (num(u['output_tokens']) ?? 0) + (num(u['cache_creation_input_tokens']) ?? 0);
            const model = typeof m['model'] === 'string' && !m['model'].startsWith('<') ? m['model'] : undefined;
            t.recs.push({ ts, tokens, ...(model ? { model } : {}) });
          }
        } catch {
          continue;
        }
      }
      t.recs = t.recs.filter((r) => r.ts >= horizon);
      out.push(...t.recs);
    }
  }
  return out;
}

/** Current 5h window: starts at the (hour-floored) first message after a 5h gap, like Claude's session limits. */
function claudeWindow(configDir: string): { tokens: number; resetsAt?: number; model?: string } {
  const now = Date.now();
  const recs = scanClaudeTranscripts(configDir, now - 2 * WINDOW_MS).sort((a, b) => a.ts - b.ts);
  let start: number | undefined;
  for (const r of recs) {
    if (start === undefined || r.ts >= start + WINDOW_MS) {
      const d = new Date(r.ts);
      d.setMinutes(0, 0, 0);
      start = d.getTime();
    }
  }
  const model = [...recs].reverse().find((r) => r.model)?.model;
  if (start === undefined || now >= start + WINDOW_MS) return { tokens: 0, ...(model ? { model } : {}) };
  const tokens = recs.filter((r) => r.ts >= start!).reduce((n, r) => n + r.tokens, 0);
  return { tokens, resetsAt: start + WINDOW_MS, ...(model ? { model } : {}) };
}

export function formatTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function claudeUsage(): UsageInfo {
  const configDirForWindow = process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude');
  const win = claudeWindow(configDirForWindow);
  const base: UsageInfo = {
    agent: 'claude',
    label: win.tokens ? `${formatTokens(win.tokens)} tok` : '—',
    tokens: win.tokens,
    ...(win.resetsAt ? { resetsAt: win.resetsAt } : {}),
    ...(win.model ? { model: win.model } : {})
  };
  const configDir = process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude');
  const candidates: string[] = [path.join(configDir, 'stats-cache.json')];
  try {
    for (const name of fs.readdirSync(configDir)) {
      if (/^usage.*\.json$/i.test(name)) candidates.push(path.join(configDir, name));
    }
  } catch {
    /* no config dir */
  }
  for (const file of candidates) {
    const data = readJson(file);
    if (!isObj(data)) continue;
    // TODO: the real schema of stats-cache.json is undocumented; probe a few likely shapes.
    const roots: Record<string, unknown>[] = [data];
    for (const key of ['usage', 'rateLimit', 'rate_limit', 'limits', 'fiveHour', 'five_hour', 'session', 'weekly']) {
      const v = data[key];
      if (isObj(v)) roots.push(v);
    }
    for (const r of roots) {
      const ex = extractRatio(r);
      if (ex.ratio !== undefined) {
        const info: UsageInfo = { ...base, ratio: ex.ratio, label: ex.label ?? base.label };
        if (ex.resetsAt) info.resetsAt = ex.resetsAt;
        if (ex.ratio >= 0.9) info.warning = 'Approaching usage limit';
        return info;
      }
    }
  }
  return base;
}

export function collectUsage(): UsageInfo[] {
  return [
    claudeUsage(),
    // TODO: codex — `~/.codex/` has no stable usage file; the CLI shows limits via `/status` only.
    { agent: 'codex', label: '—' },
    // TODO: gemini — quota is only visible via the CLI / Google Cloud console.
    { agent: 'gemini', label: '—' },
    // TODO: ollama — local, no quota; could show model list / VRAM in the future.
    { agent: 'ollama', label: '—' }
  ];
}
