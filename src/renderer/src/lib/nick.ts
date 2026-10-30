import { useSyncExternalStore } from 'react';
import { askText } from './prompt';

/**
 * What AgentO calls the user instead of "Manager": a nickname chosen once, shown as it was typed. null = never asked,
 * '' = asked and skipped. Kept in localStorage, so every window of the app (the panels window too) reads the same.
 */
const KEY = 'asm.nick';
const EVENT = 'asm:nick';

export function storedNick(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setNick(v: string): void {
  try {
    localStorage.setItem(KEY, v.trim());
  } catch {
    /* not kept */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** The nickname ('' when none). */
export const useNick = (): string => useSyncExternalStore(subscribe, () => storedNick() ?? '');

/** How the user is addressed: the nickname as typed, or "Manager" until one is set. */
export const callName = (nick: string): string => nick || 'Manager';
export const useCallName = (): string => callName(useNick());

/** Ask what to call the user; a cancel on the first ask is remembered (not asked again), a later cancel changes nothing. */
export async function askNick(first = false): Promise<void> {
  const name = await askText(first ? 'What should I call you?' : 'Your nickname', {
    initial: first ? '' : storedNick() ?? '',
    placeholder: 'A name or nickname'
  });
  if (name !== null) setNick(name);
  else if (first) setNick('');
}
