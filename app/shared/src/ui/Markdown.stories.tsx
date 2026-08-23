import type { Meta, StoryObj } from '@storybook/react';
import MarkdownContent from './Markdown';

const meta: Meta<typeof MarkdownContent> = {
  title: 'UI/Markdown',
  component: MarkdownContent,
};

export default meta;
type Story = StoryObj<typeof MarkdownContent>;

export const Basic: Story = {
  args: { content: '# Title\n\nA paragraph with **bold** and *italic* text.\n' },
};
export const HeadingAnchors: Story = {
  args: {
    content: '## Section one\n\nText under the first section.\n\n### Subsection\n\nMore text.\n',
  },
};
export const Code: Story = {
  args: { content: 'An inline `code()` span and a fenced block:\n\n```ts\nconst add = (a: number, b: number) => a + b;\n```\n' },
};
export const Table: Story = {
  args: { content: '| Feature | Status |\n| ------- | ------ |\n| Tokens | done |\n| Stories | done |\n' },
};
export const CJK: Story = {
  args: { content: '## 标题\n\n这是中文段落，包含、标点、以及 **加粗** 内容。\n' },
};
export const Empty: Story = { args: { content: '' } };
