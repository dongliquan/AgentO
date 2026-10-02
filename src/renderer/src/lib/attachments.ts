import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerMessage } from '@shared/protocol';
import { send } from '@/client';

/** An image attached to an order or a message: shown as a thumbnail, sent as a file path the daemon saved it to. */
export interface Attachment {
  id: string;
  name: string;
  /** object URL for the thumbnail */
  url: string;
  /** set once the daemon saved it */
  path?: string;
  error?: string;
}

const waiting = new Map<string, { resolve: (path: string) => void; reject: (e: Error) => void }>();

/** Called by the client for every server message: completes pending saves. */
export function onAttachmentMessage(msg: ServerMessage): void {
  if (msg.type === 'attachment.saved') {
    waiting.get(msg.ref)?.resolve(msg.path);
    waiting.delete(msg.ref);
  } else if (msg.type === 'error' && msg.ref === 'attachment.save') {
    // errors carry the request type, not its ref: fail every pending save
    for (const w of waiting.values()) w.reject(new Error(msg.message));
    waiting.clear();
  }
}

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
}

function save(file: File): Promise<string> {
  const ref = Math.random().toString(36).slice(2);
  return toBase64(file).then(
    (data) =>
      new Promise<string>((resolve, reject) => {
        waiting.set(ref, { resolve, reject });
        send({ type: 'attachment.save', ref, name: file.name || 'image.png', data });
      })
  );
}

/** The image files among pasted / dropped items. */
export function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  return [...list.files].filter((f) => f.type.startsWith('image/'));
}

/**
 * The text to send with its images: the paths are appended so the receiving session opens them (Claude Code and
 * Codex read an image file from its path).
 */
export function withAttachments(text: string, items: Attachment[]): string {
  const paths = items.map((a) => a.path).filter((p): p is string => !!p);
  if (paths.length === 0) return text;
  return `${text}\n\n[Attached image${paths.length > 1 ? 's' : ''} — open ${paths.length > 1 ? 'them' : 'it'} to see]\n${paths.map((p) => `- ${p}`).join('\n')}`;
}

/** Attachments of one message box: add (paste / drop / pick), remove, clear after sending. */
export function useAttachments(): {
  items: Attachment[];
  add: (files: File[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** some image is still being saved */
  busy: boolean;
} {
  const [items, setItems] = useState<Attachment[]>([]);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    []
  );
  const patch = (id: string, p: Partial<Attachment>): void => {
    if (live.current) setItems((cur) => cur.map((a) => (a.id === id ? { ...a, ...p } : a)));
  };
  const add = useCallback((files: File[]) => {
    for (const f of files) {
      const a: Attachment = { id: Math.random().toString(36).slice(2), name: f.name || 'image.png', url: URL.createObjectURL(f) };
      setItems((cur) => [...cur, a]);
      save(f).then(
        (path) => patch(a.id, { path }),
        (e: Error) => patch(a.id, { error: e.message })
      );
    }
  }, []);
  const remove = useCallback((id: string) => {
    setItems((cur) => {
      const a = cur.find((x) => x.id === id);
      if (a) URL.revokeObjectURL(a.url);
      return cur.filter((x) => x.id !== id);
    });
  }, []);
  const clear = useCallback(() => {
    setItems((cur) => {
      for (const a of cur) URL.revokeObjectURL(a.url);
      return [];
    });
  }, []);
  return { items, add, remove, clear, busy: items.some((a) => !a.path && !a.error) };
}
