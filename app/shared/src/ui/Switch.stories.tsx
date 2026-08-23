import type { Meta, StoryObj } from '@storybook/react';
import { Switch } from './Switch';
import { useState } from 'react';

const meta: Meta<typeof Switch> = {
  title: 'UI/Form/Switch',
  component: Switch,
  argTypes: {
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Off: Story = {
  args: { checked: false, onChange: () => {}, 'aria-label': 'Dark mode' },
};

export const On: Story = {
  args: { checked: true, onChange: () => {}, 'aria-label': 'Dark mode' },
};

export const Disabled: Story = {
  args: { checked: true, disabled: true, onChange: () => {}, 'aria-label': 'Coming soon' },
};

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = useState(true);
    return (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--td-ink)' }}>
        <Switch checked={checked} onChange={setChecked} />
        Notifications
      </label>
    );
  },
};
