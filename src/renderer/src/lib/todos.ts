import { useSyncExternalStore } from 'react';

/* ---------- the manager's to-do list, by day (kept in this browser) ---------- */

export interface Todo {
  id: string;
  text: string;
  /** the day it is planned for (Date.toDateString) */
  day: string;
  /** when it was checked off (that day's "done") */
  doneAt?: number;
  /** the project it goes to as an order */
  projectId?: string;
  /** sent to the project's coach (now), or scheduled for 09:00 */
  sentAt?: number;
  scheduled?: string;
}
const KEY = 'asm.report.todos';
let todos: Todo[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Todo[];
  } catch {
    return [];
  }
})();
const subs = new Set<() => void>();
export function saveTodos(next: Todo[]): void {
  todos = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(-1000)));
  } catch {
    /* not kept */
  }
  subs.forEach((f) => f());
}
/** A new to-do planned for a day (Date.toDateString). */
export const newTodo = (text: string, day: string): Todo => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, day });

export const useTodos = (): Todo[] =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => todos
  );
