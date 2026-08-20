import type { Meta, StoryObj } from '@storybook/react';
import MessageSearchPanel from './MessageSearchPanel';
import type { ChatMessage } from '../types/chat';

const messages: ChatMessage[] = [
  { id: 'm1', role: 'user', timestamp: '2025-06-01T10:00:00Z', blocks: [{ kind: 'text', content: 'Fix the login bug' }] },
  { id: 'm2', role: 'agent', agentName: 'Claude Code', timestamp: '2025-06-01T10:00:05Z', blocks: [{ kind: 'text', content: 'I found the issue in auth.ts. The token refresh was failing.' }] },
  { id: 'm3', role: 'agent', agentName: 'Codex', timestamp: '2025-06-01T10:00:10Z', blocks: [{ kind: 'tool_use', callId: 't1', toolName: 'Edit', input: { file_path: 'src/auth.ts' }, status: 'completed' }] },
];

const meta: Meta<typeof MessageSearchPanel> = {
  title: 'Shared/MessageSearchPanel',
  component: MessageSearchPanel,
  args: {
    messages,
    open: true,
    onClose: () => {},
    onJumpToMessage: () => {},
    searchLabel: 'Search messages',
    searchPlaceholder: 'Type to search...',
    noResultsLabel: 'No results found',
  },
};

export default meta;
type Story = StoryObj<typeof MessageSearchPanel>;

export const Default: Story = {};

export const EmptyResults: Story = {
  args: {
    ...meta.args,
  },
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector('input')!;
    input.value = 'xyznothing';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  },
};
