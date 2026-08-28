import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { createTestI18n, useTestI18nLanguage } from '@shared/testing/i18n';
import type { AgentHubPlatform } from '@shared/platform';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import {
  ChatEngineeringColumn,
  engineeringPreviewSignal,
  resolveEngineeringPreview,
} from './ChatEngineeringColumn';
import { WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT } from './desktopChromeEvents';
import { WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT } from './workbenchPreviewEvents';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

/** Real zh bundle for pure resolveEngineeringPreview assertions (#2032). */
const tZh = createTestI18n({ lng: 'zh' }).getFixedT('zh', SHARED_WORKBENCH_I18N_NAMESPACE);

const platform = {
  surface: 'desktop',
  capabilities: {
    localEdge: true,
    localFiles: true,
    browserPreview: true,
    localTerminal: true,
  },
  conversations: { list: async () => [] },
  runs: { submitComposerIntent: async () => ({ intentId: 'x' }) },
} as unknown as AgentHubPlatform;

function evidence(id: string, path = `reports/${id}.md`): RuntimeEvidenceSnapshot {
  return {
    runId: 'run-1',
    diffs: [],
    artifacts: [{
      id,
      runId: 'run-1',
      threadId: 'thread-1',
      kind: 'file',
      path,
      sizeBytes: 20,
      createdAt: `2026-08-25T00:00:0${id.length}.000Z`,
    }],
    previews: [],
  };
}

function evidenceWithArtifacts(): RuntimeEvidenceSnapshot {
  return {
    runId: 'run-1',
    diffs: [],
    artifacts: [
      {
        id: 'artifact-first', runId: 'run-1', threadId: 'thread-1', kind: 'file',
        path: 'reports/first.md', sizeBytes: 10, createdAt: '2026-08-25T00:00:01.000Z',
      },
      {
        id: 'artifact-second', runId: 'run-1', threadId: 'thread-1', kind: 'file',
        path: 'reports/second.md', sizeBytes: 20, createdAt: '2026-08-25T00:00:02.000Z',
      },
    ],
    previews: [],
  };
}

function auxTab(name: string): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Aux panel' })).getByRole('tab', { name });
}

describe('ChatEngineeringColumn Preview (#1966)', () => {
  it('resolves real preview evidence without constructing a URL', () => {
    expect(engineeringPreviewSignal(undefined)).toBeNull();
    const resolved = resolveEngineeringPreview(tZh, evidence('artifact-1'));
    expect(resolved?.kind).toBe('file');
    if (resolved?.kind === 'file') {
      expect(resolved.file.name).toBe('reports/artifact-1.md');
      expect(resolved.file.contentRef).toEqual({
        kind: 'artifact', runId: 'run-1', id: 'artifact-1',
      });
      expect(resolved.file.content).not.toContain('http://');
    }
  });

  it('auto-focuses Preview for new artifacts without changing inspector detail state', () => {
    const { rerender } = render(
      <ChatEngineeringColumn
        inspector={<div data-testid="inspector-detail" data-mode="files" />}
        hasWorkspace
        localFiles
        conversationId="conv-a"
        runtimeEvidence={evidence('artifact-1')}
        platform={platform}
      />,
    );

    expect(auxTab('预览')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('engineering-preview-pane')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-detail')).toHaveAttribute('data-mode', 'files');

    fireEvent.click(auxTab('会话'));
    expect(auxTab('会话')).toHaveAttribute('aria-selected', 'true');

    // Same evidence must not fight the user's selected aux tab.
    rerender(
      <ChatEngineeringColumn
        inspector={<div data-testid="inspector-detail" data-mode="files" />}
        hasWorkspace
        localFiles
        conversationId="conv-a"
        runtimeEvidence={evidence('artifact-1')}
        platform={platform}
      />,
    );
    expect(auxTab('会话')).toHaveAttribute('aria-selected', 'true');

    // A genuinely new artifact focuses Preview, while inspector remains details-only.
    rerender(
      <ChatEngineeringColumn
        inspector={<div data-testid="inspector-detail" data-mode="files" />}
        hasWorkspace
        localFiles
        conversationId="conv-a"
        runtimeEvidence={evidence('artifact-2')}
        platform={platform}
      />,
    );
    expect(auxTab('预览')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('inspector-detail')).toHaveAttribute('data-mode', 'files');
  });

  it('keeps the tab keyboard reachable and switches inspector only on explicit details action', () => {
    const detailEvents: Array<string | undefined> = [];
    const listener = (event: Event) => {
      detailEvents.push((event as CustomEvent<{ mode?: string }>).detail?.mode);
    };
    window.addEventListener(WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT, listener);

    render(
      <ChatEngineeringColumn
        inspector={<div data-testid="inspector-detail" data-mode="overview" />}
        hasWorkspace
        localFiles
        conversationId="conv-a"
        runtimeEvidence={evidence('artifact-1')}
        platform={platform}
      />,
    );

    const previewTab = auxTab('预览');
    previewTab.focus();
    fireEvent.keyDown(previewTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(auxTab('提交'));

    fireEvent.click(screen.getByRole('button', { name: '在详情中查看' }));
    expect(detailEvents).toEqual(['files']);
    expect(screen.getByTestId('inspector-detail')).toHaveAttribute('data-mode', 'overview');

    window.removeEventListener(WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT, listener);
  });

  it('shows an honest empty state and disables details when no content exists', () => {
    render(
      <ChatEngineeringColumn
        inspector={<div />}
        hasWorkspace={false}
        localFiles
        conversationId="conv-idle"
        platform={platform}
      />,
    );
    fireEvent.click(auxTab('预览'));
    expect(screen.getByText(/不会构造虚假地址或内容/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在详情中查看' })).toBeDisabled();
  });
});


describe('ChatEngineeringColumn artifact focus intent (#1992, F10)', () => {
  it('resolves the clicked artifact rather than the newest artifact', () => {
    const snapshot = evidenceWithArtifacts();
    const focused = resolveEngineeringPreview(tZh, snapshot, {
      artifactId: 'artifact-first', artifactRunId: 'run-1',
    });
    expect(focused?.kind).toBe('file');
    if (focused?.kind === 'file') expect(focused.file.name).toBe('reports/first.md');
  });

  it('returns null for a missing focus target instead of showing another artifact', () => {
    expect(resolveEngineeringPreview(tZh, evidenceWithArtifacts(), {
      artifactId: 'artifact-missing', artifactRunId: 'run-1',
    })).toBeNull();
  });

  it('activates Preview for the matching conversation without changing the inspector', () => {
    const snapshot = evidenceWithArtifacts();
    render(
      <ChatEngineeringColumn
        inspector={<div data-testid="inspector-detail" data-mode="overview" />}
        hasWorkspace
        localFiles
        conversationId="conv-target"
        runtimeEvidence={snapshot}
        platform={platform}
      />,
    );
    // User may have left another aux tab selected; the intent must reclaim
    // Preview because this is an explicit artifact click.
    fireEvent.click(auxTab('会话'));
    expect(auxTab('会话')).toHaveAttribute('aria-selected', 'true');
    act(() => {
      window.dispatchEvent(new CustomEvent(WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT, {
        detail: { conversationId: 'conv-target', artifactId: 'artifact-first', artifactRunId: 'run-1' },
      }));
    });
    expect(auxTab('预览')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('inspector-detail')).toHaveAttribute('data-mode', 'overview');
    expect(screen.getByTitle('reports/first.md')).toBeInTheDocument();
    expect(screen.queryByTitle('reports/second.md')).toBeNull();
  });

  it('ignores a focus intent from another conversation', () => {
    render(
      <ChatEngineeringColumn
        inspector={<div data-testid="inspector-detail" data-mode="overview" />}
        hasWorkspace
        localFiles
        conversationId="conv-target"
        runtimeEvidence={evidenceWithArtifacts()}
        platform={platform}
      />,
    );
    fireEvent.click(auxTab('会话'));
    act(() => {
      window.dispatchEvent(new CustomEvent(WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT, {
        detail: { conversationId: 'conv-other', artifactId: 'artifact-first', artifactRunId: 'run-1' },
      }));
    });
    expect(auxTab('会话')).toHaveAttribute('aria-selected', 'true');
  });
});
