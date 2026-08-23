import type { Meta, StoryObj } from '@storybook/react';
import { Select } from './Select';

const meta: Meta<typeof Select> = {
  title: 'UI/Form/Select',
  component: Select,
  argTypes: {
    invalid: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

const options: Array<[string, string, boolean?]> = [
  ['auto', 'Auto'],
  ['mock', 'Mock'],
  ['fixture', 'Fixture'],
  ['observed', 'Observed'],
  ['real', 'Approved real (disabled)', true],
  ['staging', 'Staging copy'],
];

export const Default: Story = {
  args: { value: 'mock', options, onChange: () => {} },
};

export const Placeholder: Story = {
  args: { value: '', options, placeholder: 'Select a mode…', onChange: () => {} },
};

export const Invalid: Story = {
  args: { value: '', options, placeholder: 'Required', invalid: true, onChange: () => {} },
};

export const LongList: Story = {
  args: {
    value: '',
    placeholder: 'Pick from 12',
    options: Array.from({ length: 12 }, (_, i) => [`op${i}`, `Option number ${i + 1}`] as [string, string]),
    onChange: () => {},
  },
};
