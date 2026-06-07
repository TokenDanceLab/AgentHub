import { describe, expect, it } from 'vitest';

import { resolveThreadSelectionId } from '@/utils/threadSelection';

describe('resolveThreadSelectionId', () => {
  it('accepts thread ids from dashboard shortcuts', () => {
    expect(resolveThreadSelectionId('thread_local')).toBe('thread_local');
  });

  it('accepts thread info objects from UI shortcuts', () => {
    expect(resolveThreadSelectionId({ threadId: 'thread_local', title: 'Local Thread' })).toBe('thread_local');
  });

  it('rejects invalid selections instead of storing object-shaped ids', () => {
    expect(resolveThreadSelectionId({ title: 'broken' })).toBeNull();
  });
});
