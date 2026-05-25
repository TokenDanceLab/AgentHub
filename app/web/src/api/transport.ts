// Transport abstraction layer for AgentHub Desktop.
// Hides connection details behind a common interface with built-in
// offline queue, exponential backoff reconnection, and localStorage persistence.

export type TransportStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
export type TransportEvent = 'message' | 'status';
export type TransportMessageHandler = (data: unknown) => void;
export type TransportStatusHandler = (status: TransportStatus) => void;

export interface Transport {
  connect(url?: string): void;
  send(data: unknown): void;
  close(): void;
  on(event: TransportEvent, handler: TransportMessageHandler | TransportStatusHandler): () => void;
  getStatus(): TransportStatus;
}

export interface TransportOptions {
  url: string;
  maxRetries?: number;       // default 5
  baseDelay?: number;         // default 1000ms
  maxDelay?: number;          // default 30000ms
  offlineQueue?: boolean;     // default true
}

const QUEUE_STORAGE_KEY = 'agenthub:offline_queue';

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private status: TransportStatus = 'disconnected';
  private retryCount = 0;
  private handlers = new Map<TransportEvent, Set<Function>>();
  private queue: unknown[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  private maxRetries: number;
  private baseDelay: number;
  private maxDelay: number;
  private useOfflineQueue: boolean;

  constructor(private opts: TransportOptions) {
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseDelay = opts.baseDelay ?? 1000;
    this.maxDelay = opts.maxDelay ?? 30000;
    this.useOfflineQueue = opts.offlineQueue ?? true;

    // Restore persisted queue from localStorage on init
    if (this.useOfflineQueue) {
      this.restoreQueue();
    }
  }

  // ── Public API ──────────────────────────────────────

  connect(url?: string): void {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const targetUrl = url ?? this.opts.url;
    const wasDisconnected = this.status === 'disconnected';
    this.setStatus(wasDisconnected ? 'connecting' : 'reconnecting');

    try {
      this.ws = new WebSocket(targetUrl);

      this.ws.onopen = () => {
        this.retryCount = 0;
        this.setStatus('connected');
        this.drainQueue();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string);
          this.emit('message', data);
        } catch {
          // Non-JSON payloads forwarded as raw string
          this.emit('message', event.data);
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.setStatus('disconnected');
        if (!this.closed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // onclose will fire after this, triggering reconnect
      };
    } catch {
      // Construction failed (e.g. invalid URL)
      this.setStatus('disconnected');
      if (!this.closed) {
        this.scheduleReconnect();
      }
    }
  }

  send(data: unknown): void {
    if (this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else if (this.useOfflineQueue) {
      this.queue.push(data);
      this.persistQueue();
    }
  }

  close(): void {
    this.closed = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
    this.handlers.clear();
    if (this.useOfflineQueue) {
      this.clearPersistedQueue();
    }
    this.queue.length = 0;
  }

  on(event: TransportEvent, handler: TransportMessageHandler | TransportStatusHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  // ── Private helpers ─────────────────────────────────

  private setStatus(status: TransportStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  private emit(event: TransportEvent, data: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(data);
      } catch (e) {
        console.error(`Transport handler error for event "${event}":`, e);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) return; // already scheduled

    if (this.retryCount >= this.maxRetries) {
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('reconnecting');
    this.retryCount++;

    // Exponential backoff: baseDelay * 2^(retries - 1), capped at maxDelay
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.retryCount - 1),
      this.maxDelay,
    );

    // Jitter (±20%) to avoid thundering herd
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    const finalDelay = Math.round(delay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, finalDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Offline queue persistence ────────────────────────

  private drainQueue(): void {
    if (this.queue.length === 0) return;
    const queued = [...this.queue];
    this.queue.length = 0;
    if (this.useOfflineQueue) {
      this.clearPersistedQueue();
    }
    for (const item of queued) {
      // Replay through send() — this will actually transmit since we are connected
      this.send(item);
    }
  }

  private persistQueue(): void {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // localStorage may be full or unavailable
    }
  }

  private restoreQueue(): void {
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (raw) {
        this.queue = JSON.parse(raw);
        localStorage.removeItem(QUEUE_STORAGE_KEY);
      }
    } catch {
      // Corrupted data — discard
    }
  }

  private clearPersistedQueue(): void {
    try {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a production-ready Transport instance.
 * Shorthand for `new WebSocketTransport({ url, ...opts })`.
 */
export function createTransport(url: string, opts?: Partial<Omit<TransportOptions, 'url'>>): Transport {
  return new WebSocketTransport({ url, ...opts });
}
