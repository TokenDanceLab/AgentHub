import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatViewTranscript } from '@shared/chatview/components/ChatViewTranscript';
import {
  resolveWebTranscriptMessages,
  resolveWebWorkbenchTranscript,
} from '@/platform/webWorkbenchTranscript';

/**
 * #1821 app-shell three-state behaviors for the Web shell:
 * - session switches must not flash the previous session's messages
 *   (placeholderData guard);
 * - an empty transcript that is still loading must not claim "no messages"
 *   (honest loading state in the shared chatview).
 */

const previousSessionRows = [
  {
    session_id: 'hub-session-old',
    seq_id: 1,
    sender_type: 'user',
    content: '上一会话的旧消息',
  },
];

describe('web shell states (#1821)', () => {
  it('hides placeholder messages during a session switch', () => {
    // While the messages query shows placeholderData, the rows still belong
    // to the previous session and must not reach the transcript projection.
    expect(resolveWebTranscriptMessages(true, previousSessionRows)).toBeUndefined();
    expect(resolveWebTranscriptMessages(false, previousSessionRows)).toBe(previousSessionRows);
    expect(resolveWebTranscriptMessages(false, undefined)).toBeUndefined();
  });

  it('renders an honest empty transcript while the new session loads', () => {
    // With the guard applied the projection sees `undefined` messages and
    // produces no blocks — never the previous session's rows.
    const blocks = resolveWebWorkbenchTranscript(
      true,
      'hub-session-new',
      resolveWebTranscriptMessages(true, previousSessionRows),
      [],
      'approved-real',
    );
    expect(blocks).toEqual([]);
  });

  it('surfaces the new session rows once its own messages arrive', () => {
    const blocks = resolveWebWorkbenchTranscript(
      true,
      'hub-session-new',
      resolveWebTranscriptMessages(false, [
        {
          session_id: 'hub-session-new',
          seq_id: 1,
          sender_type: 'user',
          content: '新会话的消息',
        },
      ]),
      [],
      'approved-real',
    );
    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'hub-message-hub-session-new-1',
        kind: 'text',
        text: '新会话的消息',
      }),
    ]);
  });

  it('shows a loading state instead of "no messages" while items load', () => {
    const { unmount } = render(
      <ChatViewTranscript transcript={[]} chatMode="group" transcriptLoading />,
    );
    // Key-echo test i18n: the loading copy key stands in for the real text.
    expect(screen.getByText('transcript.loading')).toBeInTheDocument();
    expect(screen.queryByText('transcript.empty')).not.toBeInTheDocument();
    unmount();

    render(<ChatViewTranscript transcript={[]} chatMode="group" />);
    expect(screen.getByText('transcript.empty')).toBeInTheDocument();
    expect(screen.queryByText('transcript.loading')).not.toBeInTheDocument();
  });
});
