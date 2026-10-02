import { DaemonClient } from '@shared/ws-client';
import type { ClientMessage, Session, SessionStatus } from '@shared/protocol';
import { useStore } from '@/store';
import { STATUS_LABELS } from '@/lib/format';
import { IS_PANELS } from '@/lib/role';
import { onAttachmentMessage } from '@/lib/attachments';
import { selectAndReveal } from '@/commands';

let client: DaemonClient | null = null;
const pendingLists = new Set<string>();
const pendingReads = new Set<string>();

export function send(msg: ClientMessage): void {
  if (!client) {
    console.warn('[client] not started, dropping', msg.type);
    return;
  }
  client.send(msg);
}

/** Request a directory listing (deduplicated while in flight). */
export function requestList(path: string, force = false): void {
  if (!force && (pendingLists.has(path) || useStore.getState().fsLists.has(path))) return;
  pendingLists.add(path);
  send({ type: 'fs.list', path });
}

/** Request file content (deduplicated while in flight). */
export function requestRead(path: string, force = false): void {
  if (!force && pendingReads.has(path)) return;
  pendingReads.add(path);
  send({ type: 'fs.read', path });
}

export function requestChanged(cwd: string): void {
  send({ type: 'fs.changed', cwd });
}

function windowIsBackground(): boolean {
  return document.hidden || !document.hasFocus();
}

function notifyTransition(prev: Session | undefined, next: Session): void {
  if (!prev || prev.status === next.status) return;
  const s: SessionStatus = next.status;
  if (s !== 'waiting' && s !== 'done' && s !== 'error') return;
  // Only the main window raises OS notifications; the panels window would duplicate them.
  if (IS_PANELS || !windowIsBackground()) return;
  const text =
    s === 'waiting' ? 'Waiting for input.' : s === 'done' ? 'Session finished.' : `Exited with error (code ${next.exitCode ?? '?'})`;
  try {
    window.desktop.notify(`${next.title} · ${STATUS_LABELS[s]}`, text, next.id);
  } catch (e) {
    console.warn('[notify]', e);
  }
}

export async function startClient(): Promise<void> {
  const store = useStore.getState();
  let info: { port: number; token: string };
  try {
    info = await window.desktop.getDaemonInfo();
  } catch (e) {
    console.error('[client] getDaemonInfo failed', e);
    store.setConnected(false);
    // retry later
    setTimeout(() => void startClient(), 2000);
    return;
  }
  client = new DaemonClient(`ws://127.0.0.1:${info.port}`, info.token);
  client.onStatus((c) => useStore.getState().setConnected(c));
  client.on((msg) => {
    onAttachmentMessage(msg);
    const st = useStore.getState();
    if (msg.type === 'session.upsert') {
      const prev = st.sessions.get(msg.session.id);
      st.apply(msg);
      notifyTransition(prev, msg.session);
      return;
    }
    if (msg.type === 'chat.created') {
      // its upsert came first: show it on the Ground and in the Session tab
      setTimeout(() => {
        selectAndReveal(msg.id);
        useStore.getState().setRightTab('detail');
      }, 50);
      return;
    }
    if (msg.type === 'fs.list.result') pendingLists.delete(msg.path);
    if (msg.type === 'fs.read.result') pendingReads.delete(msg.path);
    if (msg.type === 'error' && msg.ref) {
      pendingLists.delete(msg.ref);
      pendingReads.delete(msg.ref);
    }
    st.apply(msg);
    if (msg.type === 'welcome') {
      // refresh git status for every folder
      const seen = new Set<string>();
      for (const p of msg.projects) for (const f of p.folders) if (!seen.has(f.path)) {
        seen.add(f.path);
        requestChanged(f.path);
      }
    }
  });
  // DaemonClient sends the `hello` message itself as soon as the socket opens.
  try {
    await client.connect();
  } catch (e) {
    console.warn('[client] initial connect failed; will keep retrying', e);
  }
}

/** After Help › Restart Daemon: re-read daemon info and reconnect (port/token may have changed). */
export async function reconnectClient(): Promise<void> {
  try {
    const info = await window.desktop.getDaemonInfo();
    if (client) {
      client.setEndpoint(`ws://127.0.0.1:${info.port}`, info.token);
      client.close();
      await client.connect().catch((e) => console.warn('[client] reconnect failed; retrying', e));
    } else {
      await startClient();
    }
  } catch (e) {
    console.error('[client] reconnect: getDaemonInfo failed', e);
  }
}
