import { create } from 'zustand';
import type { ChatEntry } from '@shared/protocol';

export interface ChatState {
  entries: ChatEntry[];
  /** false when the session has no transcript to follow (non-Claude or unknown id) */
  available: boolean;
}

/** Chat transcripts per session id, kept apart from the main store so terminal output doesn't re-render them. */
export const useChats = create<{ chats: Record<string, ChatState> }>(() => ({ chats: {} }));

export function applyChatSnapshot(id: string, entries: ChatEntry[], available: boolean): void {
  useChats.setState((st) => ({ chats: { ...st.chats, [id]: { entries: [...entries], available } } }));
}

export function applyChatUpsert(id: string, changed: ChatEntry[]): void {
  useChats.setState((st) => {
    const cur = st.chats[id] ?? { entries: [], available: true };
    const entries = [...cur.entries];
    const index = new Map(entries.map((e, i) => [e.id, i]));
    for (const e of changed) {
      const i = index.get(e.id);
      if (i === undefined) {
        index.set(e.id, entries.length);
        entries.push(e);
      } else entries[i] = e;
    }
    return { chats: { ...st.chats, [id]: { entries, available: true } } };
  });
}

export function dropChat(id: string): void {
  useChats.setState((st) => {
    const chats = { ...st.chats };
    delete chats[id];
    return { chats };
  });
}
