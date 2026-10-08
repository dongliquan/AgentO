import { create } from 'zustand';
import type { ChatEntry } from '@shared/protocol';

export interface ChatState {
  entries: ChatEntry[];
  /** false when the session has no transcript to follow (non-Claude or unknown id) */
  available: boolean;
}

/** Chat transcripts per session id, kept apart from the main store so terminal output doesn't re-render them. */
export const useChats = create<{ chats: Record<string, ChatState> }>(() => ({ chats: {} }));

/** Per-session indexes keep a small transcript delta from rebuilding an O(n) id map. */
const entryIndexes = new Map<string, Map<string, number>>();

export function applyChatSnapshot(id: string, entries: ChatEntry[], available: boolean): void {
  entryIndexes.set(id, new Map(entries.map((e, i) => [e.id, i])));
  useChats.setState((st) => ({ chats: { ...st.chats, [id]: { entries: [...entries], available } } }));
}

export function applyChatUpsert(id: string, changed: ChatEntry[]): void {
  useChats.setState((st) => {
    const cur = st.chats[id] ?? { entries: [], available: true };
    const entries = [...cur.entries];
    let index = entryIndexes.get(id);
    // Defensive recovery if a chat was initialized outside applyChatSnapshot.
    if (!index || index.size !== cur.entries.length) {
      index = new Map(cur.entries.map((e, i) => [e.id, i]));
      entryIndexes.set(id, index);
    }
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
  entryIndexes.delete(id);
  useChats.setState((st) => {
    const chats = { ...st.chats };
    delete chats[id];
    return { chats };
  });
}
