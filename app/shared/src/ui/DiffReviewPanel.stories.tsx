import type { Meta, StoryObj } from '@storybook/react';
import { DiffReviewPanel, type DiffReviewFile } from './DiffReviewPanel';
import type { DiffHunk } from '../diff';

const meta: Meta<typeof DiffReviewPanel> = {
  title: 'UI/DiffReviewPanel',
  component: DiffReviewPanel,
};

export default meta;
type Story = StoryObj<typeof DiffReviewPanel>;

const hunk: DiffHunk = {
  header: '@@ -1,4 +1,5 @@',
  lines: [
    { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'export function sum(a, b) {' },
    { type: 'deleted', oldLineNumber: 2, content: '  return a + b;' },
    { type: 'added', newLineNumber: 2, content: '  return a + b; // numbers only' },
    { type: 'context', oldLineNumber: 3, newLineNumber: 3, content: '}' },
  ],
};

const files: DiffReviewFile[] = [
  {
    filePath: 'src/utils.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    hunks: [hunk],
  },
  {
    filePath: 'src/index.ts',
    status: 'added',
    additions: 6,
    deletions: 0,
    hunks: [
      {
        header: '@@ -0,0 +1,6 @@',
        lines: [
          { type: 'added', newLineNumber: 1, content: "import { sum } from './utils';" },
          { type: 'added', newLineNumber: 2, content: 'console.log(sum(1, 2));' },
        ],
      },
    ],
  },
];

export const Default: Story = { args: { files, runId: 'run-42' } };
export const Empty: Story = { args: { files: [] } };
export const WithCustomLabels: Story = {
  args: {
    files,
    labels: {
      empty: 'Nothing to review',
      acceptAll: 'Approve all',
      rejectAll: 'Discard all',
      acceptLine: 'Accept line',
      rejectLine: 'Reject line',
    },
  },
};
