import { describe, expect, it } from 'vitest';
import type { HubMessage } from '@/api/hubClient';
import { mergeMessageHistory, oldestMessageSequence } from './webMessageHistory';

function message(id: string, seq: number, clientId?: string): HubMessage {
  return { id, seq_id: seq, client_msg_id: clientId, session_id: 'session', sender_type: 'user', sender_id: 'user', content_type: 'text', content: id };
}

describe('Web message history', () => {
  it('keeps loaded earlier pages on refresh while replacing edits and confirmed optimistic rows', () => {
    const current = [message('old', 1), message('recent', 81), message('optimistic', Number.MAX_SAFE_INTEGER, 'client-1')];
    const latest = [{ ...message('recent', 81), content: 'edited' }, message('confirmed', 82, 'client-1')];
    const merged = mergeMessageHistory(current, latest);
    expect(merged.map((item) => item.id)).toEqual(['old', 'recent', 'confirmed']);
    expect(merged[1]?.content).toBe('edited');
    expect(oldestMessageSequence(merged)).toBe(1);
  });
  it('uses the earliest stored sequence for backward pagination, excluding pending sends', () => {
    expect(oldestMessageSequence([message('pending', Number.MAX_SAFE_INTEGER)])).toBeUndefined();
    expect(oldestMessageSequence([message('new', 200), message('old', 121)])).toBe(121);
    expect(mergeMessageHistory([message('m2', 2)], [message('m1', 1), message('m2', 2)]).map((item) => item.id)).toEqual(['m1', 'm2']);
  });
});
