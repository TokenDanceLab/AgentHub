// ChatViewBridge checkpoint chain (#1968): a checkpoint TranscriptBlock in
// the display transcript must reach the timeline as a clickable card whose
// click bubbles back up through ChatViewTranscript → Transcript → AgentGroup
// → RowItem to the bridge's onCheckpointClick callback.
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { TranscriptBlock } from '@shared/transcript';
import type { RowItem } from '@shared/chatview/types';
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

vi.mock('virtua', () => ({
  // jsdom has no layout engine; a passthrough Virtualizer renders every child.
  Virtualizer: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// Must import after the mocks.
import { ChatViewBridge } from './ChatViewBridge';

const author = { id: 'edge', name: 'Edge', role: 'agent' as const };

function checkpointBlock(): TranscriptBlock {
  return {
    id: 'blk-cp',
    kind: 'checkpoint',
    createdAt: '2026-08-26T01:00:00.000Z',
    author,
    runId: 'run-42',
    checkpointId: 'cp-run-42',
    fileCount: 2,
    totalBytes: 1536,
  } as TranscriptBlock;
}

function artifactBlock(): TranscriptBlock {
  return {
    id: 'blk-artifact',
    kind: 'artifact',
    createdAt: '2026-08-26T01:01:00.000Z',
    author,
    title: 'result.md',
    artifactId: 'artifact-42',
    path: 'reports/result.md',
    artifactKind: 'file',
    action: 'created',
  } as TranscriptBlock;
}

function userBlock(): TranscriptBlock {
  return {
    id: 'blk-user',
    kind: 'text',
    createdAt: '2026-08-26T00:59:00.000Z',
    author: { id: 'u1', name: 'User', role: 'user' },
    text: 'Please fix the build',
  } as TranscriptBlock;
}

function renderBridge(onCheckpointClick?: (item: RowItem) => void) {
  return render(
    <ChatViewBridge
      displayTranscript={[userBlock(), checkpointBlock()]}
      {...(onCheckpointClick ? { onCheckpointClick } : {})}
      selectedBlockIds={new Set<string>()}
      selectionMode={false}
      softHiddenBlockIds={new Set<string>()}
      actionedBlockIds={new Set<string>()}
      dismissedPinnedIds={new Set<string>()}
    />,
  );
}

function renderArtifactBridge(onArtifactClick: (item: RowItem) => void) {
  return render(
    <ChatViewBridge
      displayTranscript={[userBlock(), artifactBlock()]}
      onArtifactClick={onArtifactClick}
      selectedBlockIds={new Set<string>()}
      selectionMode={false}
      softHiddenBlockIds={new Set<string>()}
      actionedBlockIds={new Set<string>()}
      dismissedPinnedIds={new Set<string>()}
    />,
  );
}

describe('ChatViewBridge checkpoint timeline (#1968)', () => {
  it('renders the checkpoint card with its file-count label', () => {
    renderBridge();
    expect(screen.getByText('Pre-run snapshot · 2 files')).toBeInTheDocument();
  });

  it('clicking the card calls onCheckpointClick with the checkpoint row', () => {
    const onCheckpointClick = vi.fn();
    const { container } = renderBridge(onCheckpointClick);
    const card = container.querySelector('.row-item.checkpoint');
    expect(card).not.toBeNull();
    fireEvent.click(card!.querySelector('button.row-hd')!);
    expect(onCheckpointClick).toHaveBeenCalledTimes(1);
    const item = onCheckpointClick.mock.calls[0][0] as RowItem;
    expect(item).toMatchObject({
      type: 'checkpoint',
      checkpointRunId: 'run-42',
      checkpointId: 'cp-run-42',
      checkpointFileCount: 2,
      checkpointTotalBytes: 1536,
    });
  });
});


describe('ChatViewBridge artifact Preview focus (#1992)', () => {
  it('maps an artifact block to a named clickable card and bubbles the row', () => {
    const onArtifactClick = vi.fn();
    const { container } = renderArtifactBridge(onArtifactClick);
    const card = container.querySelector('.row-item.file');
    expect(card).not.toBeNull();
    expect(card!.querySelector('button.row-hd')).toHaveAccessibleName('Open artifact reports/result.md');
    fireEvent.click(card!.querySelector('button.row-hd')!);
    expect(onArtifactClick).toHaveBeenCalledTimes(1);
    expect(onArtifactClick.mock.calls[0][0]).toMatchObject({
      artifactId: 'artifact-42',
      artifactPath: 'reports/result.md',
    });
  });
});
