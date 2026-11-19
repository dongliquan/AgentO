/**
 * Scheduled messages (routines): the daemon types a message into a session on schedule — every N minutes, every day at
 * HH:MM, or once — through the same path as a message the user types into it (a stopped session is woken, a busy one gets
 * it queued), with no window open. `{run}` in the text becomes the run number.
 */
import { randomUUID } from 'node:crypto';
import type { Routine, RoutineInput } from '@shared/protocol';
import type { Store } from './store';
import type { SessionManager } from './sessions';
import type { Team } from './team';
import { log } from './log';

const TICK_MS = 10_000;

/** Next run after `from` for a routine's schedule. */
export function nextRun(r: Pick<Routine, 'everyMinutes' | 'dailyAt'>, from: number): number {
  if (r.dailyAt) {
    const [h, m] = r.dailyAt.split(':').map((x) => Number(x));
    const d = new Date(from);
    d.setHours(h ?? 9, m ?? 0, 0, 0);
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return from + Math.max(1, r.everyMinutes ?? 60) * 60_000;
}

export class Routines {
  private timer: NodeJS.Timeout;

  constructor(
    private store: Store,
    private sessions: SessionManager,
    private team: Team,
    private onChange: (routines: Routine[]) => void
  ) {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  list(): Routine[] {
    return this.store.listRoutines();
  }

  save(input: RoutineInput): Routine {
    if (!input.text.trim()) throw new Error('The scheduled message has no text');
    if (!this.sessions.get(input.target.sessionId)) throw new Error('Session not found');
    if (!input.dailyAt && !(input.everyMinutes && input.everyMinutes > 0)) throw new Error('Set "every N minutes" or "daily at"');
    if (input.dailyAt && !/^\d{1,2}:\d{2}$/.test(input.dailyAt)) throw new Error('"daily at" must look like 09:00');
    const prev = input.id ? this.store.getRoutine(input.id) : undefined;
    const now = Date.now();
    const r: Routine = {
      id: prev?.id ?? randomUUID(),
      name: input.name.trim() || input.text.trim().slice(0, 40),
      target: { sessionId: input.target.sessionId },
      text: input.text.trim(),
      enabled: input.enabled,
      nextAt: 0,
      runs: prev?.runs ?? 0,
      createdAt: prev?.createdAt ?? now
    };
    if (input.once) r.once = true;
    if (input.dailyAt) r.dailyAt = input.dailyAt;
    else r.everyMinutes = input.everyMinutes;
    if (prev?.lastRunAt) r.lastRunAt = prev.lastRunAt;
    r.nextAt = input.runNow ? now : nextRun(r, now);
    this.store.saveRoutine(r);
    this.onChange(this.list());
    if (input.runNow && r.enabled) this.run(r.id);
    return r;
  }

  delete(id: string): void {
    this.store.deleteRoutine(id);
    this.onChange(this.list());
  }

  /** a removed session takes its scheduled messages with it */
  forgetSession(sessionId: string): void {
    let any = false;
    for (const r of this.store.listRoutines()) {
      if (r.target.sessionId === sessionId) {
        this.store.deleteRoutine(r.id);
        any = true;
      }
    }
    if (any) this.onChange(this.list());
  }

  /** Send the message now and schedule the next run. scheduled: a busy session skips this run (no pile-up behind a long turn). */
  run(id: string, scheduled = false): void {
    const r = this.store.getRoutine(id);
    if (!r) throw new Error('Scheduled message not found');
    const s = this.sessions.get(r.target.sessionId);
    if (!s) {
      this.store.deleteRoutine(r.id);
      this.onChange(this.list());
      return;
    }
    if (scheduled && (s.status === 'working' || s.status === 'starting')) {
      log.info(`scheduled message "${r.name}" skipped: ${s.title} is busy`);
      r.nextAt = nextRun(r, Date.now());
      this.store.saveRoutine(r);
      this.onChange(this.list());
      return;
    }
    const n = r.runs + 1;
    try {
      this.team.message(s.id, r.text.replace(/\{run\}|\{day\}/g, String(n)));
      log.info(`scheduled message "${r.name}" #${n} sent to`, s.title);
    } catch (e) {
      log.warn(`scheduled message "${r.name}" #${n} failed`, e);
    }
    const now = Date.now();
    if (r.once) {
      this.store.deleteRoutine(r.id);
      this.onChange(this.list());
      return;
    }
    r.runs = n;
    r.lastRunAt = now;
    r.nextAt = nextRun(r, now);
    this.store.saveRoutine(r);
    this.onChange(this.list());
  }

  private tick(): void {
    const now = Date.now();
    for (const r of this.store.listRoutines()) {
      if (r.enabled && r.nextAt <= now) this.run(r.id, true);
    }
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
