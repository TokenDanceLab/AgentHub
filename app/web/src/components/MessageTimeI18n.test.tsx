import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import ChatView from './ChatView';
import IMMessageView from './IM/IMMessageView';
import type { ChatMessage } from './ChatView.types';
import type { IMMessage } from './IM/types';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 160,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 160,
      })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

const now = new Date('2026-05-30T10:00:00Z');

const chatMessage: ChatMessage = {
  id: 'chat-1',
  role: 'agent',
  agentName: 'Codex',
  timestamp: '2026-05-30T08:00:00Z',
  blocks: [{ kind: 'text', content: 'Ready.' }],
};

const imMessage: IMMessage = {
  id: 'im-1',
  sessionId: 'session-1',
  senderId: 'agent-1',
  senderName: 'Codex',
  senderType: 'agent',
  authority: 'hub',
  content: '同步完成。',
  timestamp: '2026-05-30T09:58:00Z',
};

describe('message time i18n', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    Element.prototype.scrollIntoView = vi.fn();
    await i18n.changeLanguage('zh');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('localizes ChatView relative time and message actions', () => {
    render(<ChatView messages={[chatMessage]} onRetry={() => {}} onDelete={() => {}} />);

    expect(screen.getByText('2小时前')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
  });

  it('localizes IM message relative time and aria label', () => {
    render(<IMMessageView messages={[imMessage]} />);

    expect(screen.getByText('2分钟前')).toBeInTheDocument();
    expect(screen.getByLabelText('Codex 的Agent消息')).toBeInTheDocument();
  });
});
