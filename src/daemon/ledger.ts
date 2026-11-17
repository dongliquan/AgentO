import type { TaskRec, TaskState } from '@shared/protocol';
import type { Store } from './store';

/**
 * The task ledger: every piece of work ("#T12") the daemon hands to a session, and the state the daemon saw it in.
 * The screens read this instead of guessing from the words of a report. Kept in kv (survives restarts); finished
 * rows older than KEEP_DONE_MS and anything beyond MAX rows are dropped.
 */
const KV = 'ledger';
const MAX = 3000;
const KEEP_DONE_MS = 14 * 86_400_000;
/** a state that ends the work for now */
const SETTLED: TaskState[] = ['reported'];

export class Ledger {
  private recs = new Map<string, TaskRec>();
  private dirty = new Set<string>();
  private saveTimer: NodeJS.Timeout | null = null;
  /** called (batched) with the rows that changed */
  onChange: (changed: TaskRec[]) => void = () => undefined;

  constructor(private store: Store) {
    for (const r of store.getKv<TaskRec[]>(KV) ?? []) this.recs.set(r.key, r);
  }

  static key(projectId: string, id: string): string {
    return `${projectId || 'team'}/${id}`;
  }

  list(): TaskRec[] {
    return [...this.recs.values()];
  }

  get(projectId: string, id: string | undefined): TaskRec | undefined {
    return id ? this.recs.get(Ledger.key(projectId, id)) : undefined;
  }

  /** A task was handed out. */
  open(rec: Omit<TaskRec, 'key' | 'state' | 'stateAt'> & { state?: TaskState }): TaskRec {
    const now = Date.now();
    const full: TaskRec = { ...rec, key: Ledger.key(rec.projectId, rec.id), state: rec.state ?? 'queued', stateAt: now };
    this.recs.set(full.key, full);
    this.touch(full.key);
    return full;
  }

  /** The daemon saw the task in another state (no-op when it is already there). */
  set(projectId: string, id: string | undefined, state: TaskState, note?: string): void {
    const r = this.get(projectId, id);
    if (!r) return;
    if (r.state === state && (note ?? r.note) === r.note) return;
    // the turn ended after the question: it still waits for the answer
    if (r.state === 'asking' && (state === 'reported' || state === 'handed') && note === undefined) return;
    // a reported task is only reopened by new work on it (asking/blocked/working), never by a late "queued"
    if (SETTLED.includes(r.state) && state === 'queued') return;
    r.state = state;
    r.stateAt = Date.now();
    if (note !== undefined) r.note = note;
    else delete r.note;
    this.touch(r.key);
  }

  /** Tasks of a session that are still open. */
  openOf(sessionId: string): TaskRec[] {
    return this.list().filter((r) => r.to === sessionId && !SETTLED.includes(r.state));
  }

  /** Forget a deleted project's tasks. */
  forgetProject(projectId: string): void {
    for (const r of this.list()) if (r.projectId === projectId) this.recs.delete(r.key);
    this.save();
  }

  private touch(key: string): void {
    this.dirty.add(key);
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const changed = [...this.dirty].map((k) => this.recs.get(k)).filter((r): r is TaskRec => r !== undefined);
      this.dirty.clear();
      this.save();
      if (changed.length) this.onChange(changed);
    }, 150);
  }

  private save(): void {
    const now = Date.now();
    let list = this.list().filter((r) => !(SETTLED.includes(r.state) && now - r.stateAt > KEEP_DONE_MS));
    if (list.length > MAX) list = list.sort((a, b) => b.stateAt - a.stateAt).slice(0, MAX);
    if (list.length !== this.recs.size) this.recs = new Map(list.map((r) => [r.key, r]));
    this.store.setKv(KV, list);
  }
}
