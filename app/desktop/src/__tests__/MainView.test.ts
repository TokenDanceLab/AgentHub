import { describe, expect, it } from 'vitest';
import { resolveViewMode } from '@/views/MainView';
import type { ChatMessage } from '@/components/ChatView.types';

const agentOnlyMessage: ChatMessage = {
  id: 'agent-stale',
  role: 'agent',
  timestamp: '2026-05-25T00:00:00Z',
  blocks: [{ kind: 'text', content: 'stale agent event' }],
};

const userMessage: ChatMessage = {
  id: 'user-1',
  role: 'user',
  timestamp: '2026-05-25T00:00:01Z',
  blocks: [{ kind: 'text', content: 'start work' }],
};

describe('resolveViewMode', () => {
  it('keeps the welcome launcher visible when only stale agent events exist', () => {
    expect(resolveViewMode([agentOnlyMessage], [agentOnlyMessage], 0, false, true)).toBe('welcome');
  });

  it('shows chat once a user message exists', () => {
    expect(resolveViewMode([userMessage, agentOnlyMessage], [agentOnlyMessage], 0, false, true)).toBe('chat');
  });
});
