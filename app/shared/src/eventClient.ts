import type { EventEnvelope, AnyEvent } from './events';

export type EventListener = (event: AnyEvent) => void;
export type EventConnectionStatus = 'connected' | 'disconnected' | 'error';
export type EventConnectionListener = (
  status: EventConnectionStatus,
  error?: string,
) => void;

export interface EventClientOptions {
  baseUrl?: string;
  cursor?: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

// ── EventClient ───────────────────────────────

export class EventClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<EventListener>();
  private connectionListeners = new Set<EventConnectionListener>();
  private typeListeners = new Map<string, Set<EventListener>>();
  private connectionListeners = new Set<EventConnectionListener>();
  private baseUrl: string;
  private cursor: string | undefined;
  private reconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private currentDelayMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastSeq = 0;

  constructor(opts: EventClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:3210').replace(
      /\/+$/,
      '',
    );
    this.cursor = opts.cursor;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = opts.maxReconnectDelayMs ?? 30000;
    this.currentDelayMs = this.reconnectDelayMs;
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

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.currentDelayMs = this.reconnectDelayMs;
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
        this.dispatchConnection('disconnected', 'Edge event stream disconnected');
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

  onConnection(listener: EventConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
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

  private dispatchConnection(
    status: EventConnectionStatus,
    error?: string,
  ): void {
    for (const fn of this.connectionListeners) {
      try {
        fn(status, error);
      } catch {
        // Don't let one listener break others.
      }
    }
  }

  // ── Reconnection ───────────────────────────

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.currentDelayMs = Math.min(
        this.currentDelayMs * 2,
        this.maxReconnectDelayMs,
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
