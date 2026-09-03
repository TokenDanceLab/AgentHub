import { describe, expect, it } from 'vitest';
import { computeTranscriptUnreadMarker } from './transcriptUnreadMarker';

function msg(id: string, seq: number, clientMsgId?: string) {
  return { id, seq_id: seq, ...(clientMsgId ? { client_msg_id: clientMsgId } : {}) };
}

describe('computeTranscriptUnreadMarker (T8 desktop IM)', () => {
  it('returns undefined when unread_count is absent or zero', () => {
    const messages = [msg('m1', 1), msg('m2', 2)];
    expect(computeTranscriptUnreadMarker(messages, undefined)).toBeUndefined();
    expect(computeTranscriptUnreadMarker(messages, 0)).toBeUndefined();
    expect(computeTranscriptUnreadMarker(messages, -1)).toBeUndefined();
  });

  it('returns undefined when there are no messages', () => {
    expect(computeTranscriptUnreadMarker([], 3)).toBeUndefined();
    expect(computeTranscriptUnreadMarker(undefined, 3)).toBeUndefined();
  });


  it('uses client_msg_id for the anchor block id when present', () => {
    const messages = [
      msg('m1', 1),
      msg('server-id-2', 2, 'client-2'),
      msg('m3', 3, 'client-3'),
    ];
    const marker = computeTranscriptUnreadMarker(messages, 2);
    expect(marker).toEqual({
      anchorBlockId: 'hub-message-client-2',
      count: 2,
      readThroughSeq: 1,
    });
  });

  it('marks every loaded message when the watermark points beyond the window', () => {
    const messages = [msg('m1', 1), msg('m2', 2), msg('m3', 3)];
    const marker = computeTranscriptUnreadMarker(messages, 99);
    expect(marker).toEqual({
      anchorBlockId: 'hub-message-m1',
      count: 3,
      readThroughSeq: undefined,
    });
  });

  it.each([
    [
      [msg('m1', 1), msg('m2', 2), msg('m3', 3), msg('m4', 4), msg('m5', 5)],
      3,
      { anchorBlockId: 'hub-message-m3', count: 3, readThroughSeq: 2 },
    ],
    [
      [msg('m5', 5), msg('m2', 2), msg('m3', 3), msg('m1', 1), msg('m4', 4)],
      2,
      { anchorBlockId: 'hub-message-m4', count: 2, readThroughSeq: 3 },
    ],
  ])('computes the unread marker for input %s', (messages, unreadCount, expected) => {
    const marker = computeTranscriptUnreadMarker(messages, unreadCount);
    expect(marker).toEqual(expected);
  });

  it('omits read-through seq for the very first message', () => {
    const messages = [msg('m1', 1), msg('m2', 2)];
    const marker = computeTranscriptUnreadMarker(messages, 2);
    expect(marker).toEqual({ anchorBlockId: 'hub-message-m1', count: 2 });
  });
});
