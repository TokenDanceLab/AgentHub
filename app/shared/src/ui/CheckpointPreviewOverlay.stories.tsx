import type { Meta, StoryObj } from '@storybook/react';
import type { CheckpointFileContent, CheckpointPort, CheckpointSummary } from '../platform/types';
import { CheckpointPreviewOverlay } from './CheckpointPreviewOverlay';

const meta: Meta<typeof CheckpointPreviewOverlay> = {
  title: 'UI/CheckpointPreviewOverlay',
  component: CheckpointPreviewOverlay,
};

export default meta;
type Story = StoryObj<typeof CheckpointPreviewOverlay>;

const summary: CheckpointSummary = {
  runId: 'run-demo',
  checkpointId: 'cp-run-demo',
  workDir: '/home/user/project',
  fileCount: 3,
  totalBytes: 2355,
  createdAt: '2026-08-26T02:00:00Z',
  files: [
    { path: 'src/main.ts', sizeBytes: 812, hash: 'h-1', hasText: true },
    { path: 'README.md', sizeBytes: 519, hash: 'h-2', hasText: true },
    { path: 'assets/icon.png', sizeBytes: 1024, hash: 'h-3', hasText: false },
  ],
};

const contents: Record<string, string> = {
  'src/main.ts': "import { run } from './runner';\n\nrun();\n",
  'README.md': '# Demo project\n\nPre-run snapshot demo.\n',
};

const port: CheckpointPort = {
  list: async () => summary,
  file: async (runId, path) => ({
    runId, path, sizeBytes: 0, hash: '', content: contents[path] ?? '',
  } satisfies CheckpointFileContent),
};

const labels = {
  summary: '{{count}} files · {{bytes}} total',
  fileListAria: 'Snapshot file list',
  selectFile: 'Select a file to view its pre-run content',
  emptyContent: 'No text preview for this file (binary or over the size cap).',
  absent: 'No snapshot found for this run (it may have been cleaned up); nothing to preview.',
  restoreUnavailable: 'Restore is not wired: write-back requires the remote-evidence track and explicit approval. This surface offers read-only preview only.',
  surfaceUnavailable: 'This surface cannot reach snapshot content (Hub-only boundary).',
  loadFailed: 'Failed to load the snapshot; try again later.',
};

const base = {
  open: true,
  runId: 'run-demo',
  title: 'Pre-run snapshot (read-only)',
  closeLabel: 'Close snapshot preview',
  labels,
  onClose: () => {},
};

export const WithFiles: Story = { args: { ...base, port } };

export const SurfaceUnavailable: Story = {
  args: { ...base }, // no port — Hub-only surface
};

export const Absent: Story = {
  args: { ...base, port: { list: async () => undefined, file: async () => undefined } },
};
