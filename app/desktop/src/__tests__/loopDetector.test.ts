import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoopDetector } from '@/utils/loopDetector';

describe('LoopDetector', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns allow for the first call', () => {
    const result = detector.recordCall('read_file', { path: '/test.txt' });
    expect(result).toBe('allow');
  });

  it('returns allow for the second call (below warn threshold)', () => {
    detector.recordCall('read_file', { path: '/test.txt' });
    const result = detector.recordCall('read_file', { path: '/test.txt' });
    expect(result).toBe('allow');
  });

  it('returns warn on the third call (default warnThreshold=3)', () => {
    detector.recordCall('read_file', { path: '/test.txt' });
    detector.recordCall('read_file', { path: '/test.txt' });
    const result = detector.recordCall('read_file', { path: '/test.txt' });
    expect(result).toBe('warn');
  });

  it('returns stop on the fifth call (default stopThreshold=5)', () => {
    for (let i = 0; i < 4; i++) {
      detector.recordCall('read_file', { path: '/test.txt' });
    }
    const result = detector.recordCall('read_file', { path: '/test.txt' });
    expect(result).toBe('stop');
  });

  it('returns allow on the fourth call (between warn and stop)', () => {
    for (let i = 0; i < 3; i++) {
      detector.recordCall('read_file', { path: '/test.txt' });
    }
    const result = detector.recordCall('read_file', { path: '/test.txt' });
    expect(result).toBe('allow');
  });

  it('respects custom thresholds', () => {
    const custom = new LoopDetector({ warnThreshold: 2, stopThreshold: 3 });
    custom.recordCall('bash', { command: 'ls' });
    const warn = custom.recordCall('bash', { command: 'ls' });
    expect(warn).toBe('warn');

    const stop = custom.recordCall('bash', { command: 'ls' });
    expect(stop).toBe('stop');
  });

  it('different args produce different signatures (allow)', () => {
    detector.recordCall('read_file', { path: '/a.txt' });
    detector.recordCall('read_file', { path: '/a.txt' });
    // 3rd call hits warn threshold
    const warnResult = detector.recordCall('read_file', { path: '/a.txt' });
    expect(warnResult).toBe('warn');

    // Different path → different signature → fresh count
    const differentResult = detector.recordCall('read_file', { path: '/b.txt' });
    expect(differentResult).toBe('allow');
  });

  it('different toolName produces different signature (allow)', () => {
    for (let i = 0; i < 3; i++) {
      detector.recordCall('read_file', { path: '/x' });
    }
    // Now read_file is at warn level
    const result = detector.recordCall('write_file', { path: '/x' });
    expect(result).toBe('allow');
  });

  it('resets count after windowMs expires', async () => {
    vi.useFakeTimers();
    const winDetector = new LoopDetector({ windowMs: 100 });

    winDetector.recordCall('read_file', { path: '/test.txt' });
    winDetector.recordCall('read_file', { path: '/test.txt' });
    // Should be warn at count 3 (exact warnThreshold)
    const warn = winDetector.recordCall('read_file', { path: '/test.txt' });
    expect(warn).toBe('warn');

    // Advance past windowMs
    vi.advanceTimersByTime(150);

    // Count should reset — first call after window
    const afterWindow = winDetector.recordCall('read_file', { path: '/test.txt' });
    expect(afterWindow).toBe('allow');
  });

  it('reset() clears all entries', () => {
    for (let i = 0; i < 4; i++) {
      detector.recordCall('read_file', { path: '/test.txt' });
    }
    expect(detector.getCount('read_file', { path: '/test.txt' })).toBe(4);

    detector.reset();

    expect(detector.getCount('read_file', { path: '/test.txt' })).toBe(0);
    const result = detector.recordCall('read_file', { path: '/test.txt' });
    expect(result).toBe('allow');
  });

  it('args with different key order produce same hash', () => {
    detector.recordCall('tool', { a: '1', b: '2' });
    detector.recordCall('tool', { a: '1', b: '2' });
    // Same values, different key order → same hash
    const result = detector.recordCall('tool', { b: '2', a: '1' });
    expect(result).toBe('warn'); // 3rd call, should be 'warn'
  });

  it('getCount returns 0 for never-seen signatures', () => {
    expect(detector.getCount('nonexistent', {})).toBe(0);
  });

  it('getCount returns the correct count', () => {
    detector.recordCall('bash', { cmd: 'ls' });
    detector.recordCall('bash', { cmd: 'ls' });
    expect(detector.getCount('bash', { cmd: 'ls' })).toBe(2);
  });
});
