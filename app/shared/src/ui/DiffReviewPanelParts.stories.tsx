import type { Meta, StoryObj } from '@storybook/react';
import {
  DiffReviewFileTabs,
  DiffReviewSideColumn,
  DiffReviewToolbar,
} from './DiffReviewPanelParts';
import { buildSideBySideRows } from './DiffReviewPanelHelpers';
import type { DiffReviewFile } from './DiffReviewPanelTypes';
import type { DiffHunk } from '../diff';

const meta: Meta<typeof DiffReviewSideColumn> = {
  title: 'UI/DiffReviewPanelParts',
  component: DiffReviewSideColumn,
};

export default meta;
type Story = StoryObj<typeof DiffReviewSideColumn>;

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
  { filePath: 'src/index.ts', status: 'added', additions: 6, deletions: 0, hunks: [] },
];

const rows = buildSideBySideRows(hunk);
const rowToHunkIndex = new Map(rows.map((_row, index) => [index, 0]));
const hunkKeyFor = (_hunkIndex: number): string => 'src/utils.ts:0';

export const SideColumn: Story = {
  render: () => (
    <DiffReviewSideColumn
      side="left"
      headerLabel="Original"
      filePath="src/utils.ts"
      rows={rows}
      activeLang="typescript"
      acceptedLines={new Set()}
      rejectedLines={new Set(['1'])}
      lineKey={(rowIndex) => `left-${rowIndex}`}
      rowToHunkIndex={rowToHunkIndex}
      hunkStates={{ 'src/utils.ts:0': 'rejected' }}
      hunkKeyFor={hunkKeyFor}
      appliedLabel="Applied"
      rejectedLabel="Rejected"
      acceptLineLabel="Accept line"
      rejectLineLabel="Reject line"
      onAcceptClick={() => {}}
      onRejectClick={() => {}}
    />
  ),
};

export const FileTabs: Story = {
  render: () => (
    <DiffReviewFileTabs
      files={files}
      safeIndex={0}
      tabsId="part-tabs"
      onSelectFile={() => {}}
    />
  ),
};

export const Toolbar: Story = {
  render: () => (
    <DiffReviewToolbar
      filePath="src/utils.ts"
      additions={1}
      deletions={1}
      modifiedCount={1}
      acceptAllLabel="Accept All"
      rejectAllLabel="Reject All"
      onAcceptAll={() => {}}
      onRejectAll={() => {}}
    />
  ),
};
