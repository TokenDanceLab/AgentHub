import type { Meta, StoryObj } from '@storybook/react';
import { CodeBlock } from './CodeBlock';

const meta: Meta<typeof CodeBlock> = {
  title: 'UI/CodeBlock',
  component: CodeBlock,
};

export default meta;
type Story = StoryObj<typeof CodeBlock>;

const longCode = Array.from(
  { length: 30 },
  (_unused, index) => `const line${index + 1} = ${index + 1};`,
).join('\n');

export const Inline: Story = { args: { children: 'const x = 1;' } };
export const Block: Story = {
  args: { className: 'language-ts', children: 'const total = items.reduce((sum, item) => sum + item, 0);\n' },
};
export const WithLanguage: Story = {
  args: { className: 'language-js', children: 'console.log("hello world");\n' },
};
export const LongCollapsed: Story = {
  args: { className: 'language-ts', children: `${longCode}\n` },
};
export const Plain: Story = {
  args: { children: 'just a code block without language\n' },
};
