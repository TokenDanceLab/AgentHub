// real_tested=true
import { describe, it, expect } from 'vitest';
import {
  breakdownContext,
  estimateTokens,
  formatCost,
  formatTokens,
  toSegments,
  type ContextBreakdown,
  type SessionMetrics,
} from './breakdown';

// ── estimateTokens ──────────────────────────────

describe('estimateTokens', () => {
  it('uses the chars/4 formula for exact multiples', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(400)).toBe(100);
  });

  it('rounds fractional tokens up to the next whole token', () => {
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
  });

  it('handles non-integer character counts', () => {
    // ceil(1.5 / 4) = ceil(0.375) = 1
    expect(estimateTokens(1.5)).toBe(1);
  });

  it('handles large character counts', () => {
    expect(estimateTokens(10_000)).toBe(2500);
  });
});

// ── breakdownContext ────────────────────────────

describe('breakdownContext', () => {
  it('returns an all-zero breakdown when messages is empty', () => {
    const result = breakdownContext([], 1000);
    expect(result).toEqual({
      system: 0,
      user: 0,
      assistant: 0,
      tool: 0,
      other: 0,
      total: 0,
    });
  });

  it('returns an all-zero breakdown when totalInputTokens is 0', () => {
    const result = breakdownContext([{ role: 'user', content: 'hello world' }], 0);
    expect(result).toEqual({
      system: 0,
      user: 0,
      assistant: 0,
      tool: 0,
      other: 0,
      total: 0,
    });
  });

  it('buckets chars by role using chars/4 and fills other up to the total', () => {
    const messages = [
      { role: 'system', content: 's'.repeat(40) }, // ceil(40/4) = 10
      { role: 'user', content: 'u'.repeat(4) }, // ceil(4/4) = 1
      { role: 'assistant', content: 'a'.repeat(16) }, // ceil(16/4) = 4
      { role: 'tool', content: 't'.repeat(2) }, // ceil(2/4) = 1
    ];
    // estimated = 16, total = 25 -> other = 9
    const result = breakdownContext(messages, 25);
    expect(result).toEqual({
      system: 10,
      user: 1,
      assistant: 4,
      tool: 1,
      other: 9,
      total: 25,
    });
  });

  it('sets other to 0 when the estimate matches the total exactly', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(100) }, // 25 est
      { role: 'assistant', content: 'b'.repeat(200) }, // 50 est
    ];
    const result = breakdownContext(messages, 75);
    expect(result).toEqual({
      system: 0,
      user: 25,
      assistant: 50,
      tool: 0,
      other: 0,
      total: 75,
    });
  });

  it('assigns the residual to other when the estimate is under the total', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(100) }, // 25 est
      { role: 'assistant', content: 'b'.repeat(200) }, // 50 est
    ];
    const result = breakdownContext(messages, 100);
    expect(result).toEqual({
      system: 0,
      user: 25,
      assistant: 50,
      tool: 0,
      other: 25,
      total: 100,
    });
  });

  it('scales buckets proportionally when the estimate exceeds the total', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(400) }, // 100 est
      { role: 'assistant', content: 'b'.repeat(400) }, // 100 est
    ];
    // scale = 100 / 200 = 0.5 -> floor(100 * 0.5) = 50 each
    const result = breakdownContext(messages, 100);
    expect(result).toEqual({
      system: 0,
      user: 50,
      assistant: 50,
      tool: 0,
      other: 0,
      total: 100,
    });
  });

  it('puts the rounding loss from floor-scaling into other', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(100) }, // 25 est
      { role: 'assistant', content: 'b'.repeat(100) }, // 25 est
    ];
    // scale = 33 / 50 = 0.66 -> floor(25 * 0.66) = 16 each, remainder 1
    const result = breakdownContext(messages, 33);
    expect(result).toEqual({
      system: 0,
      user: 16,
      assistant: 16,
      tool: 0,
      other: 1,
      total: 33,
    });
  });

  it('can floor a small bucket to zero while scaling', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(4) }, // 1 est
      { role: 'assistant', content: 'b'.repeat(16) }, // 4 est -> estimated 5
    ];
    // scale = 3 / 5 = 0.6 -> floor(1 * 0.6) = 0, floor(4 * 0.6) = 2
    const result = breakdownContext(messages, 3);
    expect(result).toEqual({
      system: 0,
      user: 0,
      assistant: 2,
      tool: 0,
      other: 1,
      total: 3,
    });
  });

  it('treats null content as an empty string', () => {
    const messages = [
      { role: 'user', content: null as unknown as string },
      { role: 'assistant', content: 'hello' }, // ceil(5/4) = 2
    ];
    const result = breakdownContext(messages, 100);
    expect(result).toEqual({
      system: 0,
      user: 0,
      assistant: 2,
      tool: 0,
      other: 98,
      total: 100,
    });
  });

  it('treats undefined content as an empty string', () => {
    const messages = [{ role: 'user', content: undefined as unknown as string }];
    const result = breakdownContext(messages, 50);
    expect(result).toEqual({
      system: 0,
      user: 0,
      assistant: 0,
      tool: 0,
      other: 50,
      total: 50,
    });
  });

  it('ignores unknown roles in buckets, leaving their weight in other under budget', () => {
    const messages = [
      { role: 'function', content: 'f'.repeat(400) }, // unknown role: no bucket
      { role: 'user', content: 'u'.repeat(100) }, // 25 est
    ];
    // estimated = 25 <= 100 -> the residual 75 lands in other
    const result = breakdownContext(messages, 100);
    expect(result).toEqual({
      system: 0,
      user: 25,
      assistant: 0,
      tool: 0,
      other: 75,
      total: 100,
    });
  });

  it('drops unknown-role chars entirely when scaling', () => {
    const messages = [
      { role: 'function', content: 'f'.repeat(400) },
      { role: 'user', content: 'u'.repeat(100) }, // 25 est > 10 total
    ];
    // scale = 10 / 25 = 0.4 -> floor(25 * 0.4) = 10, other = max(0, 0)
    const result = breakdownContext(messages, 10);
    expect(result).toEqual({
      system: 0,
      user: 10,
      assistant: 0,
      tool: 0,
      other: 0,
      total: 10,
    });
  });

  it('accepts the SessionMetrics messages shape', () => {
    const metrics: SessionMetrics = {
      model: 'test-model',
      provider: 'test-provider',
      contextLimit: 200_000,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      totalCost: 0.001,
      messages: [{ role: 'user', content: 'a'.repeat(100) }],
    };
    const result = breakdownContext(metrics.messages, metrics.inputTokens);
    expect(result).toEqual({
      system: 0,
      user: 25,
      assistant: 0,
      tool: 0,
      other: 75,
      total: 100,
    });
  });
});

// ── toSegments ──────────────────────────────────

describe('toSegments', () => {
  const emptyBreakdown: ContextBreakdown = {
    system: 0,
    user: 0,
    assistant: 0,
    tool: 0,
    other: 0,
    total: 0,
  };

  it('returns an empty array when total is zero', () => {
    expect(toSegments(emptyBreakdown)).toEqual([]);
    // Non-zero buckets are ignored whenever total is zero.
    expect(toSegments({ ...emptyBreakdown, user: 5 })).toEqual([]);
  });

  it('returns an empty array when every bucket is zero despite a positive total', () => {
    expect(toSegments({ ...emptyBreakdown, total: 100 })).toEqual([]);
  });

  it('filters zero-token buckets and keeps the fixed key order', () => {
    const segments = toSegments({
      ...emptyBreakdown,
      user: 50,
      tool: 25,
      other: 25,
      total: 100,
    });
    expect(segments.map((segment) => segment.key)).toEqual(['user', 'tool', 'other']);
  });

  it('computes width and percent for equal quarters', () => {
    const segments = toSegments({
      system: 25,
      user: 25,
      assistant: 25,
      tool: 25,
      other: 0,
      total: 100,
    });
    expect(segments).toHaveLength(4);
    for (const segment of segments) {
      expect(segment.width).toBe(25);
      expect(segment.percent).toBe(25);
    }
  });

  it('rounds percent to one decimal while keeping full-precision width', () => {
    const segments = toSegments({ ...emptyBreakdown, user: 2, other: 1, total: 3 });
    const userSegment = segments.find((segment) => segment.key === 'user');
    const otherSegment = segments.find((segment) => segment.key === 'other');

    expect(userSegment?.width).toBeCloseTo(66.66666666666666, 6);
    expect(userSegment?.percent).toBe(66.7);
    expect(otherSegment?.width).toBeCloseTo(33.33333333333333, 6);
    expect(otherSegment?.percent).toBe(33.3);
  });

  it('caps a single full bucket at width 100 and percent 100', () => {
    const segments = toSegments({ ...emptyBreakdown, user: 100, total: 100 });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.key).toBe('user');
    expect(segments[0]?.tokens).toBe(100);
    expect(segments[0]?.width).toBe(100);
    expect(segments[0]?.percent).toBe(100);
  });

  it('emits a lone other segment when only other is populated', () => {
    const segments = toSegments({ ...emptyBreakdown, other: 50, total: 50 });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.key).toBe('other');
    expect(segments[0]?.tokens).toBe(50);
    expect(segments[0]?.width).toBe(100);
    expect(segments[0]?.percent).toBe(100);
  });
});

// ── formatTokens ────────────────────────────────

describe('formatTokens', () => {
  it('returns "0" for negative values', () => {
    expect(formatTokens(-1)).toBe('0');
    expect(formatTokens(-0.5)).toBe('0');
  });

  it('returns a plain string for values under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(999)).toBe('999');
  });

  it('returns a plain string for fractional values under 1000', () => {
    expect(formatTokens(0.5)).toBe('0.5');
    expect(formatTokens(999.9)).toBe('999.9');
  });

  it('formats thousands with one decimal and a K suffix', () => {
    expect(formatTokens(1000)).toBe('1.0K');
  });

  it('rounds K-tier values to one decimal', () => {
    expect(formatTokens(1234)).toBe('1.2K');
    expect(formatTokens(1560)).toBe('1.6K');
    expect(formatTokens(9999)).toBe('10.0K');
  });

  it('handles the upper K boundary just below one million', () => {
    expect(formatTokens(999_999)).toBe('1000.0K');
  });

  it('formats millions with one decimal and an M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(1_234_567)).toBe('1.2M');
  });

  it('handles the upper M boundary just below one billion', () => {
    expect(formatTokens(999_999_999)).toBe('1000.0M');
  });

  it('formats billions with zero decimals and a B suffix', () => {
    expect(formatTokens(1_000_000_000)).toBe('1B');
    expect(formatTokens(1_234_567_890)).toBe('1B');
  });

  it('formats trillions with zero decimals and a T suffix', () => {
    expect(formatTokens(1_000_000_000_000)).toBe('1T');
  });

  it('clamps to the T suffix beyond the unit table', () => {
    expect(formatTokens(1e15)).toBe('1000T');
    expect(formatTokens(1e18)).toBe('1000000T');
  });
});

// ── formatCost ──────────────────────────────────

describe('formatCost', () => {
  it('formats zero with two decimals', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('returns "$0.00" for negative values', () => {
    expect(formatCost(-1)).toBe('$0.00');
    expect(formatCost(-0.001)).toBe('$0.00');
  });

  it('rounds small fractional costs down', () => {
    expect(formatCost(0.0423)).toBe('$0.04');
    expect(formatCost(0.004)).toBe('$0.00');
  });

  it('rounds small fractional costs up', () => {
    expect(formatCost(0.046)).toBe('$0.05');
    expect(formatCost(0.006)).toBe('$0.01');
  });

  it('formats whole dollars with cents', () => {
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(10)).toBe('$10.00');
  });

  it('rounds large values to two decimals', () => {
    expect(formatCost(1.239)).toBe('$1.24');
    expect(formatCost(1.234)).toBe('$1.23');
    expect(formatCost(1_234_567.891)).toBe('$1234567.89');
  });
});
