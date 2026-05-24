// File read cache — deduplicates file reads by path + mtime.
// When an agent repeatedly reads the same file (unchanged mtime),
// subsequent reads within the same run can be served from cache.
//
// This cache is per-run — call reset() when a new run starts.

interface CacheEntry {
  content: string;
  mtime: number;
  readCount: number;
}

export class FileReadCache {
  private cache: Map<string, CacheEntry> = new Map();
  private totalReads = 0;
  private cacheHits = 0;

  /**
   * Returns cached content if path + mtime match, otherwise undefined.
   * Increments readCount on hit for stats tracking.
   */
  get(path: string, mtime: number): string | undefined {
    this.totalReads++;
    const entry = this.cache.get(path);
    if (entry && entry.mtime === mtime) {
      this.cacheHits++;
      entry.readCount++;
      return entry.content;
    }
    return undefined;
  }

  /**
   * Store content keyed by path + mtime.
   * Overwrites any existing entry for the same path.
   */
  set(path: string, mtime: number, content: string): void {
    const existing = this.cache.get(path);
    this.cache.set(path, {
      content,
      mtime,
      readCount: (existing?.readCount ?? 0) + 1,
    });
  }

  /** Clear all cached entries. */
  reset(): void {
    this.cache.clear();
    this.totalReads = 0;
    this.cacheHits = 0;
  }

  /** Get current cache statistics. */
  getStats(): { totalReads: number; cacheHits: number; size: number } {
    return {
      totalReads: this.totalReads,
      cacheHits: this.cacheHits,
      size: this.cache.size,
    };
  }
}
