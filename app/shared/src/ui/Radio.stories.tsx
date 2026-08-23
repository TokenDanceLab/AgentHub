import type { Meta, StoryObj } from '@storybook/react';
import { Radio } from './Radio';

const meta: Meta<typeof Radio> = {
  title: 'UI/Form/Radio',
  component: Radio,
  argTypes: {
    invalid: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Radio>;

export const Default: Story = {
  args: { label: 'Auto', name: 'mode', value: 'auto', checked: false, onChange: () => {} },
};

export const Checked: Story = {
  args: { label: 'Auto', name: 'mode', value: 'auto', checked: true, onChange: () => {} },
};

export const Invalid: Story = {
  args: { label: 'Auto', name: 'mode', value: 'auto', checked: false, invalid: true, onChange: () => {} },
};

export const Disabled: Story = {
  args: { label: 'Observed', name: 'mode', value: 'observed', checked: true, disabled: true, onChange: () => {} },
};

export const Group: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} role="radiogroup" aria-label="Data mode">
      <Radio label="Auto" name="mode" value="auto" checked={false} onChange={() => {}} />
      <Radio label="Mock" name="mode" value="mock" checked onChange={() => {}} />
      <Radio label="Approved real" name="mode" value="real" checked={false} disabled onChange={() => {}} />
    </div>
  ),
};
