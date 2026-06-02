import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MainView, { resolveViewMode } from '@/views/MainView';
import type { ChatMessage } from '@/components/ChatView.types';

const userMessage: ChatMessage = {
  id: 'user-1',
  role: 'user',
  timestamp: '2026-05-28T10:30:00Z',
  blocks: [{ kind: 'text', content: 'hello' }],
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/components/ChatView', () => ({
  default: ({ onSendMessage }: { onSendMessage?: (message: string) => void }) => (
    <button type="button" onClick={() => onSendMessage?.('suggested prompt')}>
      mock chat suggestion
    </button>
  ),
}));

vi.mock('@/components/WelcomeScreen', () => ({
  default: ({ onSendMessage }: { onSendMessage?: (message: string) => void }) => (
    <button type="button" onClick={() => onSendMessage?.('suggested prompt')}>
      mock chat suggestion
    </button>
  ),
}));

describe('MainView', () => {
  it('keeps the chat visible while a run starts if the optimistic user bubble exists', () => {
    expect(resolveViewMode([userMessage], [], 1, true, true)).toBe('chat');
  });

  it('routes empty-chat suggestions through the selected runtime', async () => {
    const onSendMessage = vi.fn();

    render(
      <MainView
        messages={[]}
        allMessages={[]}
        threadsCount={0}
        isStreaming={false}
        isConnected={true}
        agents={[]}
        selectedAgentId="claude-code"
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onSendMessage={onSendMessage}
      />,
    );

    fireEvent.click(await screen.findByText('mock chat suggestion'));

    expect(onSendMessage).toHaveBeenCalledWith('suggested prompt', 'claude-code');
  });
});
