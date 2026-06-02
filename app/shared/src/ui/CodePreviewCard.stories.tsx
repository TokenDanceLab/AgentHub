import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CodePreviewCard } from './CodePreviewCard';

const meta: Meta<typeof CodePreviewCard> = {
  title: 'UI/CodePreviewCard',
  component: CodePreviewCard,
};

export default meta;
type Story = StoryObj<typeof CodePreviewCard>;

export const DiffPreview: Story = {
  args: {
    title: 'app/mobile/src/views/RunStatusView.tsx',
    meta: '+12 -4',
    code: [
      '+import { CodePreviewCard } from "@agenthub/shared/ui";',
      '-<pre className="mobileDiffCode">{diffFileText(file)}</pre>',
      '+<CodePreviewCard title={diffFilePath(file)} code={diffFileText(file)} />',
    ].join('\n'),
  },
};

export const Truncated: Story = {
  args: {
    title: 'edge-server/internal/api/handlers.go',
    meta: 'preview',
    maxLines: 2,
    code: ['func handleRun() {', '  enqueue(run)', '  notify(reviewers)', '}'].join('\n'),
  },
};
