/**
 * Minimal, dependency-free WebSocket client for the daemon protocol.
 * Works in the renderer (browser WebSocket) and in Node (pass the `ws` constructor).
 */
import type { ClientMessage, ServerMessage } from './protocol';

/** The subset of the WebSocket API we rely on (browser WebSocket and `ws` both satisfy it). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export type MessageHandler = (msg: ServerMessage) => void;
export type StatusHandler = (connected: boolean) => void;

const WS_OPEN = 1;

export interface DaemonClientOptions {
  /** 'ui' (default) or 'cli' */
  client?: 'ui' | 'cli';
  /** initial reconnect delay in ms (default 500) */
  minBackoffMs?: number;
  /** max reconnect delay in ms (default 10000) */
  maxBackoffMs?: number;
}

export class DaemonClient {
  private ws: WebSocketLike | null = null;
  private handlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private queue: string[] = [];
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff: number;
  private connectedFlag = false;
  private readonly Impl: WebSocketCtor;
  private readonly opts: Required<DaemonClientOptions>;

  constructor(
    private url: string,
    private token: string,
    WebSocketImpl?: WebSocketCtor,
    opts: DaemonClientOptions = {}
  ) {
    const g = globalThis as unknown as { WebSocket?: WebSocketCtor };
    const impl = WebSocketImpl ?? g.WebSocket;
    if (!impl) throw new Error('No WebSocket implementation available; pass one to DaemonClient');
    this.Impl = impl;
    this.opts = {
      client: opts.client ?? 'ui',
      minBackoffMs: opts.minBackoffMs ?? 500,
      maxBackoffMs: opts.maxBackoffMs ?? 10_000
    };
    this.backoff = this.opts.minBackoffMs;
  }

  get connected(): boolean {
    return this.connectedFlag;
  }

  /** Update endpoint (e.g. after daemon restart on a different port). Takes effect on next (re)connect. */
  setEndpoint(url: string, token: string): void {
    this.url = url;
    this.token = token;
  }

  /** Resolves once the socket is open and the hello has been sent. Rejects only on the first attempt failing. */
  connect(): Promise<void> {
    this.closedByUser = false;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      this.open(
        () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        }
      );
    });
  }

  private open(onOpen?: () => void, onFail?: (err: Error) => void): void {
    if (this.closedByUser) return;
    let ws: WebSocketLike;
    try {
      ws = new this.Impl(this.url);
    } catch (e) {
      onFail?.(e instanceof Error ? e : new Error(String(e)));
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.backoff = this.opts.minBackoffMs;
      ws.send(JSON.stringify({ type: 'hello', token: this.token, client: this.opts.client } satisfies ClientMessage));
      for (const m of this.queue.splice(0)) ws.send(m);
      this.setConnected(true);
      onOpen?.();
    };
    ws.onmessage = (ev) => {
      let parsed: ServerMessage;
      try {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
        parsed = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      for (const h of this.handlers) {
        try {
          h(parsed);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[DaemonClient] handler error', err);
        }
      }
    };
    ws.onerror = () => {
      if (!opened) onFail?.(new Error(`WebSocket connect failed: ${this.url}`));
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!opened) onFail?.(new Error(`WebSocket closed before open: ${this.url}`));
      this.setConnected(false);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private setConnected(v: boolean): void {
    if (this.connectedFlag === v) return;
    this.connectedFlag = v;
    for (const cb of this.statusHandlers) {
      try {
        cb(v);
      } catch {
        /* ignore */
      }
    }
  }

  /** Sends now if connected; otherwise queues until the next successful (re)connect. */
  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WS_OPEN && this.connectedFlag) {
      this.ws.send(data);
    } else {
      // Keystrokes are transient terminal input. Replaying them after reconnect can execute stale commands.
      if (msg.type === 'session.input') return;
      this.queue.push(data);
      if (this.queue.length > 1000) this.queue.shift();
    }
  }

  on(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStatus(cb: StatusHandler): () => void {
    this.statusHandlers.add(cb);
    return () => {
      this.statusHandlers.delete(cb);
    };
  }

  /** Waits for the next message matching `pred` (or rejects after timeoutMs). */
  waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs = 10_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('DaemonClient.waitFor timeout'));
      }, timeoutMs);
      const off = this.on((m) => {
        if (pred(m)) {
          clearTimeout(timer);
          off();
          resolve(m);
        }
      });
    });
  }

  /** Stops reconnecting and closes the socket. */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.setConnected(false);
  }
}
