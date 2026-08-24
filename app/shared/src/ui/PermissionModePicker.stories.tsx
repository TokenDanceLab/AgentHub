import type { Meta, StoryObj } from '@storybook/react';
import { PermissionModePicker, type PermissionModeOption } from './PermissionModePicker';

const meta: Meta<typeof PermissionModePicker> = {
  title: 'UI/Composer/PermissionModePicker',
  component: PermissionModePicker,
  argTypes: {
    value: {
      control: 'select',
      options: ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'],
    },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof PermissionModePicker>;

const OPTIONS: PermissionModeOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'plan', label: 'Plan Mode' },
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'dontAsk', label: 'Don\'t Ask' },
];

export const Default: Story = {
  args: { value: 'default', label: 'Permissions', options: OPTIONS, onChange: () => {} },
};

export const AcceptEdits: Story = {
  args: { value: 'acceptEdits', label: 'Accept Edits', options: OPTIONS, onChange: () => {} },
};

export const PlanMode: Story = {
  args: { value: 'plan', label: 'Plan Mode', options: OPTIONS, onChange: () => {} },
};

export const BypassPermissions: Story = {
  args: { value: 'bypassPermissions', label: 'Bypass', options: OPTIONS, onChange: () => {} },
};

export const Disabled: Story = {
  args: { value: 'default', label: 'Permissions', options: OPTIONS, disabled: true, onChange: () => {} },
};

export const CustomAriaLabel: Story = {
  args: {
    value: 'default',
    label: 'Approval mode',
    ariaLabel: 'Approval mode: Default',
    options: OPTIONS,
    onChange: () => {},
  },
};
