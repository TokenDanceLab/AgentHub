import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  breakdownContext,
  toSegments,
  formatTokens,
  formatCost,
} from '@shared/context/breakdown';

// ── estimateTokens ──────────────────────────────

describe('estimateTokens', () => {
  it('estimates 4 chars = 1 token', () => {
    expect(estimateTokens(4)).toBe(1);
  });

  it('rounds up fractional tokens (chars/4)', () => {
    expect(estimateTokens(5)).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens(0)).toBe(0);
  });

  it('handles typical message lengths', () => {
    // 100 chars -> 25 tokens
    expect(estimateTokens(100)).toBe(25);
    // 400 chars -> 100 tokens
    expect(estimateTokens(400)).toBe(100);
  });
});

// ── breakdownContext ────────────────────────────

describe('breakdownContext', () => {
  it('returns zero breakdown for empty messages', () => {
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

  it('returns zero breakdown when totalInputTokens is 0', () => {
    const result = breakdownContext(
      [{ role: 'user', content: 'hello world' }],
      0,
    );
    expect(result.total).toBe(0);
  });

  it('splits messages by role proportionally', () => {
    // 100 char user message = 25 estimated tokens
    // 200 char assistant message = 50 estimated tokens
    // Total estimated = 75, actual = 100, so 25 go to "other"
    const messages = [
      { role: 'user', content: 'a'.repeat(100) },
      { role: 'assistant', content: 'b'.repeat(200) },
    ];
    const result = breakdownContext(messages, 100);
    expect(result.user).toBe(25);
    expect(result.assistant).toBe(50);
    expect(result.other).toBe(25);
    expect(result.total).toBe(100);
  });

  it('scales proportionally when estimate exceeds actual input', () => {
    // 400 char user msg = 100 est tokens
    // 400 char assistant msg = 100 est tokens
    // Total est = 200, actual input = 100 -> scale factor = 0.5
    // user = floor(100 * 0.5) = 50, assistant = floor(100 * 0.5) = 50
    const messages = [
      { role: 'user', content: 'a'.repeat(400) },
      { role: 'assistant', content: 'b'.repeat(400) },
    ];
    const result = breakdownContext(messages, 100);
    expect(result.user).toBe(50);
    expect(result.assistant).toBe(50);
    expect(result.other).toBe(0);
    expect(result.total).toBe(100);
  });

  it('handles system role messages', () => {
    const messages = [
      { role: 'system', content: 'a'.repeat(200) },
      { role: 'user', content: 'b'.repeat(100) },
    ];
    // system: ceil(200/4) = 50, user: ceil(100/4) = 25, est = 75
    // actual = 80, other = 5
    const result = breakdownContext(messages, 80);
    expect(result.system).toBe(50);
    expect(result.user).toBe(25);
    expect(result.other).toBe(5);
  });

  it('handles tool role messages', () => {
    const messages = [
      { role: 'tool', content: 'a'.repeat(200) },
    ];
    const result = breakdownContext(messages, 100);
    expect(result.tool).toBe(50);
    expect(result.other).toBe(50);
  });

  it('ignores unknown roles (not in system/user/assistant/tool)', () => {
    const messages = [
      { role: 'unknown_role', content: 'a'.repeat(400) },
      { role: 'user', content: 'b'.repeat(100) },
    ];
    // only user contributes: ceil(100/4) = 25, est = 25
    // actual = 100, other = 75
    const result = breakdownContext(messages, 100);
    expect(result.user).toBe(25);
    expect(result.system).toBe(0);
    expect(result.assistant).toBe(0);
    expect(result.tool).toBe(0);
    expect(result.other).toBe(75);
  });

  it('handles messages with empty content', () => {
    const messages = [
      { role: 'user', content: '' },
      { role: 'assistant', content: 'hello' },
    ];
    const result = breakdownContext(messages, 100);
    expect(result.user).toBe(0);
    expect(result.assistant).toBe(2); // ceil(5/4) = 2
  });
});

// ── toSegments ──────────────────────────────────

describe('toSegments', () => {
  it('returns empty array for zero total', () => {
    const breakdown = {
      system: 0, user: 0, assistant: 0, tool: 0, other: 0, total: 0,
    };
    expect(toSegments(breakdown)).toEqual([]);
  });

  it('filters out zero-token entries', () => {
    const breakdown = {
      system: 0, user: 50, assistant: 50, tool: 0, other: 0, total: 100,
    };
    const segments = toSegments(breakdown);
    expect(segments).toHaveLength(2);
    expect(segments[0].key).toBe('user');
    expect(segments[1].key).toBe('assistant');
  });

  it('computes width and percent correctly', () => {
    const breakdown = {
      system: 25, user: 25, assistant: 25, tool: 25, other: 0, total: 100,
    };
    const segments = toSegments(breakdown);
    for (const seg of segments) {
      expect(seg.width).toBeCloseTo(25);
      expect(seg.percent).toBe(25);
    }
  });

  it('preserves key order: system, user, assistant, tool, other', () => {
    const breakdown = {
      system: 20, user: 20, assistant: 20, tool: 20, other: 20, total: 100,
    };
    const keys = toSegments(breakdown).map((s) => s.key);
    expect(keys).toEqual(['system', 'user', 'assistant', 'tool', 'other']);
  });
});

// ── formatTokens ────────────────────────────────

describe('formatTokens', () => {
  it('returns plain number for values under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokens(1234)).toBe('1.2K');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(9999)).toBe('10.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1234567)).toBe('1.2M');
  });

  it('handles negative numbers', () => {
    expect(formatTokens(-1)).toBe('0');
  });
});

// ── formatCost ──────────────────────────────────

describe('formatCost', () => {
  it('formats small cents', () => {
    expect(formatCost(0.0423)).toBe('$0.04');
  });

  it('formats dollars', () => {
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(10)).toBe('$10.00');
  });

  it('handles zero', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('handles negative', () => {
    expect(formatCost(-1)).toBe('$0.00');
  });
});
