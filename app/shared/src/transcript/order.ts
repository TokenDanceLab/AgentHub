import type { TranscriptBlock } from './types';

export function orderTranscriptBlocks<T extends TranscriptBlock>(blocks: T[]): T[] {
  return blocks
    .map((block, index) => ({
      block,
      index,
      timestamp: transcriptBlockTimestampMs(block),
    }))
    .sort((a, b) => {
      const aHasTimestamp = Number.isFinite(a.timestamp);
      const bHasTimestamp = Number.isFinite(b.timestamp);
      if (aHasTimestamp && bHasTimestamp && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.index - b.index;
    })
    .map((entry) => entry.block);
}

export function transcriptBlockTimestampMs(block: TranscriptBlock): number {
  const parsed = Date.parse(block.createdAt ?? '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
