/* ═══════════════════════════════════════════════════════════════════════
   UNREAD DIVIDER tests (T8 desktop IM path) — rendering + placement
   ══════════════════════════════════════════════════════════════════════ */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Transcript } from './Transcript';
import type { TranscriptItem } from '../transcript-item';

// jsdom has no layout, so virtua's Virtualizer measures zero height and
// renders no children. Stub it as a passthrough for these render tests.
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function user(id: string, text: string): TranscriptItem {
  return { type: 'user', id, name: 'You', time: '10:00', text };
}

describe('Transcript unread divider', () => {
  it('renders nothing when no unreadDivider prop is given', () => {
    const { queryByRole } = render(
      <Transcript items={[user('m1', 'a'), user('m2', 'b')]} chatMode="dm" />,
    );
    expect(queryByRole('separator')).toBeNull();
  });

  it('renders the divider with label and read-through copy', () => {
    const { getByRole, getByText } = render(
      <Transcript
        items={[user('m1', 'a'), user('m2', 'b'), user('m3', 'c')]}
        chatMode="dm"
        unreadDivider={{ index: 2, label: '2 条未读', readThrough: '已读到 #1' }}
      />,
    );
    const divider = getByRole('separator');
    expect(divider.className).toContain('unread-divider');
    expect(getByText('2 条未读')).toBeTruthy();
    expect(getByText('已读到 #1')).toBeTruthy();
  });

  it('renders the divider above the anchor item (positional)', () => {
    const { container } = render(
      <Transcript
        items={[user('m1', 'a'), user('m2', 'b'), user('m3', 'c'), user('m4', 'd')]}
        chatMode="dm"
        unreadDivider={{ index: 2, label: '2 条未读' }}
      />,
    );
    const children = Array.from(container.querySelectorAll('.transcript > *')) as HTMLElement[];
    const dividerIndex = children.findIndex((el) => el.className.includes('unread-divider'));
    expect(dividerIndex).toBeGreaterThanOrEqual(0);
    // The two read messages (user bubbles) come before the divider.
    const beforeCount = children
      .slice(0, dividerIndex)
      .reduce((acc, el) => acc + el.querySelectorAll('.user-bubble').length, 0);
    expect(beforeCount).toBe(2);
    // The unread messages follow the divider.
    const afterCount = children
      .slice(dividerIndex + 1)
      .reduce((acc, el) => acc + el.querySelectorAll('.user-bubble').length, 0);
    expect(afterCount).toBe(2);
  });

  it('supports an index at the very start (all messages unread)', () => {
    const { getByRole } = render(
      <Transcript
        items={[user('m1', 'a'), user('m2', 'b')]}
        chatMode="dm"
        unreadDivider={{ index: 0, label: '2 条未读' }}
      />,
    );
    expect(getByRole('separator')).toBeTruthy();
  });
});
