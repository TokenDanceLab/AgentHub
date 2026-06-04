import type { EventEnvelope, AnyEvent } from './events';

export type EventListener = (event: AnyEvent) => void;
export type EventConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error';
export type EventConnectionListener = (
  status: EventConnectionStatus,
  error?: string,
) => void;

export interface ReconnectOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

const defaultReconnect: ReconnectOptions = {
  maxRetries: Infinity,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
};

export interface EventClientOptions {
  baseUrl?: string;
  cursor?: string;
  reconnect?: Partial<ReconnectOptions>;
}

// ── EventClient ───────────────────────────────

export class EventClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<EventListener>();
  private connectionListeners = new Set<EventConnectionListener>();
  private typeListeners = new Map<string, Set<EventListener>>();
  private baseUrl: string;
  private cursor: string | undefined;
  private reconnect: ReconnectOptions;
  private currentDelayMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastSeq = 0;
  private retryCount = 0;

  constructor(opts: EventClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:3210').replace(
      /\/+$/,
      '',
    );
    this.cursor = opts.cursor;
    this.reconnect = { ...defaultReconnect, ...opts.reconnect };
    this.currentDelayMs = this.reconnect.baseDelay;
  }

  // ── Connection ─────────────────────────────

  get wsUrl(): string {
    const http = this.baseUrl;
    const ws = http.replace(/^http/, 'ws');
    const qs = this.cursor
      ? `?cursor=${encodeURIComponent(this.cursor)}`
      : '';
    return `${ws}/v1/events${qs}`;
  }

  connect(): void {
    if (this.destroyed) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.dispatchConnection('connecting');
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.currentDelayMs = this.reconnect.baseDelay;
      this.retryCount = 0;
      this.dispatchConnection('connected');
    };

    this.ws.onmessage = (msg: MessageEvent<string>) => {
      try {
        const raw = JSON.parse(msg.data) as EventEnvelope;
        if (typeof raw.seq === 'number' && raw.seq > this.lastSeq) {
          this.lastSeq = raw.seq;
          this.cursor = String(raw.seq);
        }
        const event = raw as AnyEvent;
        this.dispatch(event);
      } catch {
        // Ignore unparseable frames.
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.dispatchConnection('disconnected');
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.dispatchConnection('error', 'Edge event stream error');
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Event dispatch ─────────────────────────

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onConnection(listener: EventConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onType(type: string, listener: EventListener): () => void {
    let set = this.typeListeners.get(type);
    if (!set) {
      set = new Set();
      this.typeListeners.set(type, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  private dispatchConnection(status: EventConnectionStatus, error?: string): void {
    for (const fn of this.connectionListeners) {
      try {
        fn(status, error);
      } catch {
        // Keep connection notifications isolated.
      }
    }
  }

  private dispatch(event: AnyEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // Don't let one listener break others.
      }
    }
    const typed = this.typeListeners.get(event.type);
    if (typed) {
      for (const fn of typed) {
        try {
          fn(event);
        } catch {
          // ignore
        }
      }
    }
  }

  // ── Reconnection (exponential backoff) ─────

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnect.maxRetries !== Infinity && this.retryCount >= this.reconnect.maxRetries) {
      this.dispatchConnection('disconnected', 'Max reconnect retries exceeded');
      return;
    }

    this.retryCount += 1;
    this.dispatchConnection('reconnecting', `Reconnecting (attempt ${this.retryCount})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.currentDelayMs = Math.min(
        this.currentDelayMs * this.reconnect.backoffFactor,
        this.reconnect.maxDelay,
      );
    }, this.currentDelayMs);
  }

  // ── State ──────────────────────────────────

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentCursor(): string | undefined {
    return this.cursor;
  }
}
