import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import type { AgentHubPlatform } from '@shared/platform';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import {
  ChatEngineeringColumn,
  engineeringPreviewSignal,
  resolveEngineeringPreview,
} from './ChatEngineeringColumn';
import { WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT } from './desktopChromeEvents';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

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

function auxTab(name: string): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Aux panel' })).getByRole('tab', { name });
}

describe('ChatEngineeringColumn Preview (#1966)', () => {
  it('resolves real preview evidence without constructing a URL', () => {
    expect(engineeringPreviewSignal(undefined)).toBeNull();
    const resolved = resolveEngineeringPreview(evidence('artifact-1'));
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
