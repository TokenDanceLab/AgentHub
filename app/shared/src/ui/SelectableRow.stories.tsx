import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { SelectableRow } from './SelectableRow';

const meta: Meta<typeof SelectableRow> = {
  title: 'UI/SelectableRow',
  component: SelectableRow,
};

export default meta;
type Story = StoryObj<typeof SelectableRow>;

export const Default: Story = {
  render: () => (
    <SelectableRow
      title="Web design convergence"
      meta="just now · 4 messages"
      icon={<MessageSquare size={14} />}
      selected
      actions={(
        <>
          <button type="button" aria-label="Rename">
            <Pencil size={12} />
          </button>
          <button type="button" aria-label="Delete">
            <Trash2 size={12} />
          </button>
        </>
      )}
    />
  ),
};
