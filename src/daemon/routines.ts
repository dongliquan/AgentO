/**
 * Repeating orders (routines): the daemon sends a routine's order on schedule — every N minutes or every day at
 * HH:MM — through the same path as an order from the Orders panel. `{day}` / `{run}` in the text become the run number.
 */
import { randomUUID } from 'node:crypto';
import type { Routine, RoutineInput } from '@shared/protocol';
import type { Store } from './store';
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
    const name = input.name.trim() || input.text.trim().slice(0, 40) || 'Routine';
    if (!input.text.trim()) throw new Error('The routine has no order text');
    if (!input.dailyAt && !(input.everyMinutes && input.everyMinutes > 0)) throw new Error('Set "every N minutes" or "daily at"');
    if (input.dailyAt && !/^\d{1,2}:\d{2}$/.test(input.dailyAt)) throw new Error('"daily at" must look like 09:00');
    const prev = input.id ? this.store.getRoutine(input.id) : undefined;
    const now = Date.now();
    const r: Routine = {
      id: prev?.id ?? randomUUID(),
      name,
      target: input.target,
      text: input.text.trim(),
      enabled: input.enabled,
      nextAt: 0,
      runs: prev?.runs ?? 0,
      createdAt: prev?.createdAt ?? now
    };
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

  /** Send the routine's order now and schedule the next run. */
  run(id: string): void {
    const r = this.store.getRoutine(id);
    if (!r) throw new Error('Routine not found');
    const n = r.runs + 1;
    const text = r.text.replace(/\{day\}|\{run\}/g, String(n));
    try {
      const to = this.team.order(r.target, text, `Routine "${r.name}" #${n}`);
      log.info(`routine "${r.name}" #${n} sent to`, to);
    } catch (e) {
      log.warn(`routine "${r.name}" #${n} failed`, e);
    }
    const now = Date.now();
    r.runs = n;
    r.lastRunAt = now;
    r.nextAt = nextRun(r, now);
    this.store.saveRoutine(r);
    this.onChange(this.list());
  }

  private tick(): void {
    const now = Date.now();
    for (const r of this.store.listRoutines()) {
      if (r.enabled && r.nextAt <= now) this.run(r.id);
    }
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
