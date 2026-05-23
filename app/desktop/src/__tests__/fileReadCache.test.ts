import { describe, it, expect, beforeEach } from 'vitest';
import { FileReadCache } from '@/utils/fileReadCache';

describe('FileReadCache', () => {
  let cache: FileReadCache;

  beforeEach(() => {
    cache = new FileReadCache();
  });

  it('returns undefined for a never-cached path', () => {
    expect(cache.get('/nonexistent.txt', 1000)).toBeUndefined();
  });

  it('returns cached content when path and mtime match', () => {
    cache.set('/file.txt', 1000, 'hello');
    expect(cache.get('/file.txt', 1000)).toBe('hello');
  });

  it('returns undefined when mtime differs (file changed)', () => {
    cache.set('/file.txt', 1000, 'old content');
    expect(cache.get('/file.txt', 2000)).toBeUndefined();
  });

  it('returns content on repeated reads with same mtime', () => {
    cache.set('/file.txt', 1000, 'repeated');
    expect(cache.get('/file.txt', 1000)).toBe('repeated');
    expect(cache.get('/file.txt', 1000)).toBe('repeated');
    expect(cache.get('/file.txt', 1000)).toBe('repeated');
  });

  it('handles multiple files independently', () => {
    cache.set('/a.txt', 100, 'content-a');
    cache.set('/b.txt', 200, 'content-b');

    expect(cache.get('/a.txt', 100)).toBe('content-a');
    expect(cache.get('/b.txt', 200)).toBe('content-b');
    expect(cache.get('/a.txt', 999)).toBeUndefined();
  });

  it('overwrites entry on new set for same path', () => {
    cache.set('/file.txt', 100, 'v1');
    cache.set('/file.txt', 200, 'v2');

    expect(cache.get('/file.txt', 100)).toBeUndefined(); // mtime changed
    expect(cache.get('/file.txt', 200)).toBe('v2'); // new mtime works
  });

  it('tracks totalReads correctly', () => {
    cache.set('/file.txt', 100, 'content');

    cache.get('/file.txt', 100); // hit
    cache.get('/file.txt', 200); // miss (different mtime)
    cache.get('/other.txt', 100); // miss (never set)

    const stats = cache.getStats();
    expect(stats.totalReads).toBe(3);
    expect(stats.cacheHits).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('reset() clears all entries and counters', () => {
    cache.set('/a.txt', 100, 'a');
    cache.set('/b.txt', 200, 'b');
    cache.get('/a.txt', 100); // hit
    cache.get('/b.txt', 200); // hit

    cache.reset();

    // stats are zero immediately after reset
    expect(cache.getStats()).toEqual({ totalReads: 0, cacheHits: 0, size: 0 });

    // entries are gone
    expect(cache.get('/a.txt', 100)).toBeUndefined();
    expect(cache.get('/b.txt', 200)).toBeUndefined();
  });

  it('getStats returns initial state', () => {
    expect(cache.getStats()).toEqual({ totalReads: 0, cacheHits: 0, size: 0 });
  });

  it('handles empty string content', () => {
    cache.set('/empty.txt', 100, '');
    expect(cache.get('/empty.txt', 100)).toBe('');
  });

  it('increments readCount on hits for stats tracking', () => {
    cache.set('/file.txt', 100, 'data');

    cache.get('/file.txt', 100); // hit 1
    cache.get('/file.txt', 100); // hit 2

    const stats = cache.getStats();
    expect(stats.totalReads).toBe(2);
    expect(stats.cacheHits).toBe(2);
  });
});
