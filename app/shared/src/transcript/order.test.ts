import { describe, expect, it } from 'vitest';
import type { TranscriptBlock } from './types';
import { orderTranscriptBlocks } from './order';

const human = { id: 'user', name: 'User', role: 'human' as const };

function textBlock(id: string, text: string, createdAt?: string): TranscriptBlock {
  return {
    id,
    kind: 'text',
    author: human,
    text,
    ...(createdAt ? { createdAt } : {}),
  };
}

describe('orderTranscriptBlocks', () => {
  it('sorts blocks with explicit timestamps chronologically', () => {
    const blocks = [
      textBlock('late', 'late', '2026-06-26T10:00:02.000Z'),
      textBlock('early', 'early', '2026-06-26T10:00:01.000Z'),
    ];

    expect(orderTranscriptBlocks(blocks).map((block) => block.id)).toEqual(['early', 'late']);
  });

  it('preserves source order when one side has no timestamp', () => {
    const blocks = [
      textBlock('history-without-clock', 'old imported message'),
      textBlock('optimistic-user', 'new user message', '2026-06-26T10:00:02.000Z'),
    ];

    expect(orderTranscriptBlocks(blocks).map((block) => block.id)).toEqual([
      'history-without-clock',
      'optimistic-user',
    ]);
  });
});
