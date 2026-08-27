// ConversationHost checkpoint wiring (#1968): clicking a checkpoint timeline
// card opens the CheckpointPreviewOverlay. Heavy sibling chrome is stubbed;
// the overlay itself is REAL so the honesty notices are asserted against the
// actual component. Platform shapes come from createMockPlatform: with a
// checkpoint seed (Desktop) the overlay fetches through the port; without it
// (Web, Hub-only) the overlay degrades to the honest surface notice.
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';

import { createInitialComposerState } from '@shared/composer';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import type { CheckpointPort } from '@shared/platform';
import type { RowItem } from '@shared/chatview/types';
import { WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT } from './workbenchPreviewEvents';
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

/** Captured ChatViewBridge props so tests can trigger the checkpoint click. */
const bridgePropsLog = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock('./ChatViewBridge', () => ({
  ChatViewBridge: (props: Record<string, unknown>) => {
    bridgePropsLog.last = props;
    return <div data-testid="chat-view-bridge" />;
  },
}));

vi.mock('./WorkspaceHeader', () => ({
  WorkspaceHeader: () => <div data-testid="workspace-header" />,
}));


vi.mock('./ComposerDispatchQueue', () => ({
  ComposerDispatchQueue: () => null,
}));

vi.mock('./MessageSearchPanel', () => ({
  default: () => null,
}));

vi.mock('./UnifiedComposer', () => ({
  UnifiedComposer: () => <div data-testid="composer" />,
}));

// Must import after the mocks.
import { ConversationHost } from './ConversationHost';

const checkpointRow: RowItem = {
  id: 'row-cp', type: 'checkpoint', label: '', status: 'ok',
  collapsible: false, standalone: true,
  checkpointId: 'cp-run-9', checkpointRunId: 'run-9',
  checkpointFileCount: 1, checkpointTotalBytes: 128,
};

const artifactRow: RowItem = {
  id: 'row-artifact', type: 'file', label: '', status: 'ok',
  collapsible: true, fileOp: 'cr', content: 'MD', extra: 'reports/result.md',
  artifactId: 'artifact-9', artifactRunId: 'run-9', artifactPath: 'reports/result.md',
};

function fakePort(): CheckpointPort {
  return {
    list: vi.fn().mockResolvedValue({
      runId: 'run-9', checkpointId: 'cp-run-9', workDir: '/tmp/p',
      fileCount: 1, totalBytes: 128, createdAt: '2026-08-26T01:00:00Z',
      files: [{ path: 'a.txt', sizeBytes: 128, hash: 'h', hasText: true }],
    }),
    file: vi.fn().mockResolvedValue({
      runId: 'run-9', path: 'a.txt', sizeBytes: 128, hash: 'h', content: 'hello',
    }),
  };
}

function renderHost(platform: ReturnType<typeof createMockPlatform>) {
  return render(
    <ConversationHost
      transcript={[]}
      inspectorCollapsed={false}
      onToggleInspector={() => {}}
      showMainchainStatus={false}
      mainchainSummary={{ nodes: [], exportEnabled: false, exportLabel: '', exportDetail: '' }}
      onExportMainchainEvidence={() => {}}
      onAgentClick={() => {}}
      onBlockContextMenu={() => {}}
      onBlockSelect={() => {}}
      onBlockAction={() => {}}
      onReviewFile={() => {}}
      onDeploySubmit={() => {}}
      selectedBlockIds={new Set<string>()}
      selectionMode={false}
      softHiddenBlockIds={new Set<string>()}
      actionedBlockIds={new Set<string>()}
      dismissedPinnedIds={new Set<string>()}
      onToast={() => {}}
      selectedExecutionTargetId="local"
      onExecutionTargetChange={() => {}}
      mentionableAgents={[]}
      showComposerAgentPicker={false}
      showComposerStatus={false}
      composerTargetLabel="Local"
      currentConversationId="conv-1"
      platform={platform}
      composer={createInitialComposerState('conv-1')}
      dispatchComposer={() => {}}
      composerInputRef={React.createRef<HTMLTextAreaElement>()}
      searchOpen={false}
      onSearchOpenChange={() => {}}
    />,
  );
}

function triggerCheckpointClick(): void {
  const onCheckpointClick = bridgePropsLog.last?.onCheckpointClick as
    | ((item: RowItem) => void)
    | undefined;
  expect(onCheckpointClick).toBeDefined();
  onCheckpointClick!(checkpointRow);
}

function triggerArtifactClick(): void {
  const onArtifactClick = bridgePropsLog.last?.onArtifactClick as
    | ((item: RowItem) => void)
    | undefined;
  expect(onArtifactClick).toBeDefined();
  onArtifactClick!(artifactRow);
}

describe('ConversationHost artifact Preview focus wiring (#1992)', () => {
  it('passes onArtifactClick and emits a conversation-scoped focus intent', () => {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener(WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT, listener);
    renderHost(createMockPlatform({ surface: 'desktop' }));
    expect(typeof bridgePropsLog.last?.onArtifactClick).toBe('function');
    triggerArtifactClick();
    window.removeEventListener(WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT, listener);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({
      conversationId: 'conv-1',
      artifactId: 'artifact-9',
      artifactPath: 'reports/result.md',
      artifactRunId: 'run-9',
    });
  });
});

describe('ConversationHost checkpoint preview wiring (#1968)', () => {
  it('passes onCheckpointClick down to the chat bridge', () => {
    renderHost(createMockPlatform({ surface: 'desktop' }));
    expect(bridgePropsLog.last).not.toBeNull();
    expect(typeof bridgePropsLog.last!.onCheckpointClick).toBe('function');
  });

  it('clicking a checkpoint card opens the real preview overlay (Desktop port)', async () => {
    const port = fakePort();
    renderHost(createMockPlatform({ surface: 'desktop', checkpoint: port }));
    expect(screen.queryByTestId('checkpoint-preview-overlay')).toBeNull();
    triggerCheckpointClick();
    expect(await screen.findByTestId('checkpoint-preview-overlay')).toBeInTheDocument();
    // Wait on the fetch OUTCOME (file list renders) before asserting the port
    // call — the overlay fetches in an open effect, so asserting the call
    // right after the dialog appears races the effect on slow runners.
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    expect(port.list).toHaveBeenCalledWith('run-9');
    // Honesty contract: the restore notice is visible; no restore action exists.
    expect(screen.getByTestId('checkpoint-restore-notice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
  });

  it('degrades to the honest surface notice without a checkpoint port (Web)', async () => {
    renderHost(createMockPlatform({ surface: 'web' }));
    triggerCheckpointClick();
    expect(await screen.findByTestId('checkpoint-surface-unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('checkpoint-restore-notice')).toBeInTheDocument();
  });

  it('closes the overlay and does not bleed across conversation switches', async () => {
    const { rerender } = renderHost(createMockPlatform({ surface: 'desktop', checkpoint: fakePort() }));
    triggerCheckpointClick();
    expect(await screen.findByTestId('checkpoint-preview-overlay')).toBeInTheDocument();
    // Conversation switch → the overlay must close (bleed guard).
    rerender(
      <ConversationHost
        transcript={[]}
        inspectorCollapsed={false}
        onToggleInspector={() => {}}
        showMainchainStatus={false}
        mainchainSummary={{ nodes: [], exportEnabled: false, exportLabel: '', exportDetail: '' }}
        onExportMainchainEvidence={() => {}}
        onAgentClick={() => {}}
        onBlockContextMenu={() => {}}
        onBlockSelect={() => {}}
        onBlockAction={() => {}}
        onReviewFile={() => {}}
        onDeploySubmit={() => {}}
        selectedBlockIds={new Set<string>()}
        selectionMode={false}
        softHiddenBlockIds={new Set<string>()}
        actionedBlockIds={new Set<string>()}
        dismissedPinnedIds={new Set<string>()}
        onToast={() => {}}
        selectedExecutionTargetId="local"
        onExecutionTargetChange={() => {}}
        mentionableAgents={[]}
        showComposerAgentPicker={false}
        showComposerStatus={false}
        composerTargetLabel="Local"
        currentConversationId="conv-2"
        platform={createMockPlatform({ surface: 'desktop', checkpoint: fakePort() })}
        composer={createInitialComposerState('conv-2')}
        dispatchComposer={() => {}}
        composerInputRef={React.createRef<HTMLTextAreaElement>()}
        searchOpen={false}
        onSearchOpenChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('checkpoint-preview-overlay')).toBeNull();
  });
});
