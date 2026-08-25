import type { Meta, StoryObj } from '@storybook/react';
import { RunReviewOverlay } from './RunReviewOverlay';
import type { DiffReviewFile } from './DiffReviewPanelTypes';

const meta: Meta<typeof RunReviewOverlay> = {
  title: 'UI/RunReviewOverlay',
  component: RunReviewOverlay,
};

export default meta;
type Story = StoryObj<typeof RunReviewOverlay>;

const files: DiffReviewFile[] = [
  {
    filePath: 'src/utils.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    hunks: [{
      header: '@@ -1,4 +1,5 @@',
      lines: [
        { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'export function sum(a, b) {' },
        { type: 'deleted', oldLineNumber: 2, content: '  return a + b;' },
        { type: 'added', newLineNumber: 2, content: '  return a + b; // numbers only' },
        { type: 'context', oldLineNumber: 3, newLineNumber: 3, content: '}' },
      ],
    }],
  },
  {
    filePath: 'src/index.ts',
    status: 'added',
    additions: 2,
    deletions: 0,
    hunks: [{
      header: '@@ -0,0 +1,2 @@',
      lines: [
        { type: 'added', newLineNumber: 1, content: "import { sum } from './utils';" },
        { type: 'added', newLineNumber: 2, content: 'console.log(sum(1, 2));' },
      ],
    }],
  },
  {
    filePath: 'src/legacy.ts',
    status: 'deleted',
    additions: 0,
    deletions: 2,
    hunks: [{
      header: '@@ -1,2 +0,0 @@',
      lines: [
        { type: 'deleted', oldLineNumber: 1, content: 'export const legacy = true;' },
        { type: 'deleted', oldLineNumber: 2, content: 'export default legacy;' },
      ],
    }],
  },
];

// #1967: run-level aggregate review overlay — default Web Hub-only surface
// is a READ-ONLY review (no write-back port wired → honest notice).
export const ReadOnly: Story = {
  args: {
    open: true,
    files,
    title: 'Run change review',
    closeLabel: 'Close run change review',
    summary: '3 files · +3 −3',
    readOnly: true,
    readOnlyNotice: 'Aggregate review is read-only: to write changes back, use the interactive diff in file preview (Desktop Local Edge only).',
    onClose: () => {},
  },
};

export const ReadOnlyZh: Story = {
  args: {
    open: true,
    files,
    title: '运行变更审查',
    closeLabel: '关闭运行变更审查',
    summary: '3 个文件 · +3 −3',
    readOnly: true,
    readOnlyNotice: '聚合审查为只读：如需写回工作区，请在文件预览中使用交互式 Diff（仅桌面本地 Edge 支持）。',
    onClose: () => {},
    panelLabels: {
      runTitle: '本次运行的全部变更',
      acceptRun: '整体批准',
      rejectRun: '整体驳回',
      acceptAll: '接受本文件',
      rejectAll: '拒绝本文件',
      acceptHunk: '接受此块',
      rejectHunk: '拒绝此块',
      applied: '已接受',
      rejected: '已拒绝',
      submitting: '提交中…',
      original: '原始',
      modified: '修改后',
      empty: '暂无变更可审查',
    },
  },
};

// Empty aggregate — the panel's empty state inside the dialog.
export const Empty: Story = {
  args: {
    open: true,
    files: [],
    title: 'Run change review',
    closeLabel: 'Close run change review',
    summary: '0 files · +0 −0',
    onClose: () => {},
  },
};
