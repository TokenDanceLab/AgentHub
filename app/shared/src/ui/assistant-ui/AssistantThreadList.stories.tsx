import type { Meta, StoryObj } from '@storybook/react';
import { AssistantThreadList } from './AssistantThreadList';
const meta: Meta<typeof AssistantThreadList> = {
  title: 'Chat/AssistantThreadList', component: AssistantThreadList,
  decorators: [(Story) => <div style={{ width: 260, height: 480 }}><Story /></div>],
  args: { currentId: 'a', conversations: [
    { id: 'a', title: 'Release planning', kind: 'group', canRename: true },
    { id: 'b', title: 'Review notes', kind: 'direct', unreadCount: 3 },
  ] },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Empty: Story = { args: { conversations: [] } };
export const Failure: Story = { args: { actions: { async rename() { throw new Error('Permission denied'); } } } };
