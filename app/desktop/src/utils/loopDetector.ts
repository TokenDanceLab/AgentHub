// Tool call loop detector — catches repeated identical tool calls
// to warn the user and auto-stop the run before tokens are wasted.

interface LoopDetectorEntry {
  signature: string; // hash of toolName + args
  count: number;
  firstSeen: number; // timestamp ms
  lastSeen: number;
  stopped: boolean;
}

export interface LoopDetectorOptions {
  /** Number of repeats before a warning toast is shown (default 3). */
  warnThreshold?: number;
  /** Number of repeats before the run is auto-cancelled (default 5). */
  stopThreshold?: number;
  /** Window in ms after which an entry is considered stale and reset (default 60000 = 1 min). */
  windowMs?: number;
}

export type LoopAction = 'allow' | 'warn' | 'stop';

export class LoopDetector {
  private calls: Map<string, LoopDetectorEntry> = new Map();

  constructor(private opts: LoopDetectorOptions = {}) {}

  /**
   * Record a tool call and return the recommended action.
   * Returns 'warn' once when the warn threshold is first crossed,
   * 'stop' once when the stop threshold is first crossed,
   * and 'allow' otherwise (including subsequent calls after a threshold has fired).
   */
  recordCall(toolName: string, args: Record<string, unknown>): LoopAction {
    const signature = this.hash(toolName, args);
    const now = Date.now();
    const windowMs = this.opts.windowMs ?? 60000;
    const existing = this.calls.get(signature);

    if (existing && now - existing.lastSeen < windowMs) {
      existing.count++;
      existing.lastSeen = now;
    } else {
      this.calls.set(signature, {
        signature,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        stopped: false,
      });
      return 'allow';
    }

    const entry = this.calls.get(signature)!;
    const stopThreshold = this.opts.stopThreshold ?? 5;
    const warnThreshold = this.opts.warnThreshold ?? 3;

    if (entry.count >= stopThreshold && !entry.stopped) {
      entry.stopped = true;
      return 'stop';
    }
    if (entry.count === warnThreshold) return 'warn';
    return 'allow';
  }

  /** Reset all tracked calls (call on a new run). */
  reset(): void {
    this.calls.clear();
  }

  /** Return the current count for a given tool+args signature, or 0. */
  getCount(toolName: string, args: Record<string, unknown>): number {
    const signature = this.hash(toolName, args);
    return this.calls.get(signature)?.count ?? 0;
  }

  // Simple fast hash: toolName + sorted JSON of args keys
  private hash(toolName: string, args: Record<string, unknown>): string {
    const sorted = Object.keys(args)
      .sort()
      .map((k) => `${k}:${String(args[k])}`)
      .join(',');
    return `${toolName}|${sorted}`;
  }
}
