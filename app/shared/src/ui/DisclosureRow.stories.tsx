import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { DisclosureRow } from './DisclosureRow';

const meta: Meta<typeof DisclosureRow> = {
  title: 'UI/DisclosureRow',
  component: DisclosureRow,
};

export default meta;
type Story = StoryObj<typeof DisclosureRow>;

function DisclosureRowDemo() {
  const [expanded, setExpanded] = useState(false);
  return (
    <DisclosureRow
      label="Session initialized with GPT-5"
      meta="plan"
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    >
      <span>Tools: Read, Write, Bash, Grep</span>
    </DisclosureRow>
  );
}

export const Default: Story = {
  render: () => <DisclosureRowDemo />,
};
