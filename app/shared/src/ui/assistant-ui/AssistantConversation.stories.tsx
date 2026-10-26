import type { Meta, StoryObj } from '@storybook/react';
import { AssistantConversation } from './AssistantConversation';
import { createMockPlatform } from '../../platform/createMockPlatform';

const meta: Meta<typeof AssistantConversation> = {
  title: 'Chat/AssistantConversation', component: AssistantConversation,
  decorators: [(Story) => <div style={{ height: 600, width: '100%' }}><Story /></div>],
  args: {
    conversationId: 'story-thread', platform: createMockPlatform(),
    intent: { conversationId: 'story-thread', mode: 'ask', approvalMode: 'suggest', mentions: [] },
    welcome: 'Start a conversation', transcript: [],
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Loading: Story = { args: { isLoading: true } };
export const Disabled: Story = { args: { isDisabled: true } };
export const Conversation: Story = { args: { transcript: [
  { id: 'human-1', kind: 'text', author: { id: 'user', role: 'human', name: 'You' }, text: 'Explain the result.' },
  { id: 'agent-1', kind: 'text', author: { id: 'agent', role: 'agent', name: 'Assistant' }, text: '**Result**\n\n```ts\nconst value = 42;\n```\n\n| Check | Result |\n| --- | --- |\n| API | Ready |' },
] } };
export const Narrow: Story = { ...Conversation, decorators: [(Story) => <div style={{ width: 320, height: 600 }}><Story /></div>] };
export const Failure: Story = { args: { platform: {
  ...createMockPlatform(), runs: { async submitComposerIntent() { throw new Error('Connection unavailable'); } },
} } };
