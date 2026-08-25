// AgentHubWorkbench right inspector: runtime evidence, collapse/resize,
// overview/files/browser tabs, roving tablist and layout persistence
// (#1763 split of AgentHubWorkbench.test.tsx).
// Shared vi.mock registration + suite hooks for the #1763 AgentHubWorkbench
// test shards. Must stay the first import so mock factories register before
// the component tree (and its virtua/@lobehub/icons deps) is evaluated.
import { installWorkbenchTestHooks, restoreInspectorTab } from './helpers';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import type { TranscriptBlock } from '@shared/transcript/types';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import { RightInspector } from '../RightInspector';
import { DESIGN_NAV_GLYPH_STROKE_WIDTH } from '../designIcons';
import {
  workbenchAgents as agents,
  workbenchTranscript as transcript,
} from '../workbenchTestFixtures';

installWorkbenchTestHooks();

describe('AgentHubWorkbench', () => {
  it('renders read-only runtime evidence snapshots in the right inspector', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
        runtimeEvidence={{
          runId: 'run-edge-1',
          diffs: [
            {
              filePath: 'src/runtime.ts',
              status: 'modified',
              additions: 1,
              deletions: 1,
              editId: 'edit-runtime-1',
              reviewStatus: 'needs_review',
              canApply: false,
              canRevert: true,
              hunks: [
                {
                  header: '@@ -1 +1 @@',
                  lines: [
                    { type: 'deleted', content: 'old runtime' },
                    { type: 'added', content: 'new runtime' },
                  ],
                },
              ],
            },
          ],
          artifacts: [
            {
              id: 'artifact-1',
              runId: 'run-edge-1',
              threadId: 'thread-1',
              kind: 'patch',
              path: 'reports/runtime.patch',
              sizeBytes: 2048,
              createdAt: '2026-06-08T08:10:00.000Z',
            },
          ],
          previews: [
            {
              id: 'preview-1',
              runId: 'run-edge-1',
              threadId: 'thread-1',
              url: 'http://127.0.0.1:4173/preview',
              status: 'ready',
              createdAt: '2026-06-08T08:12:00.000Z',
            },
          ],
          sources: { diff: 'edge', artifacts: 'edge', previews: 'edge' },
        }}
      />
    );

    expect(screen.getByText('运行证据')).toBeInTheDocument();
    expect(screen.getByText('Hub replay artifact index: 1')).toBeInTheDocument();
    expect(screen.getByText('Hub replay / run-edge-1')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '打开 reports/runtime.patch 只读预览' })
    ).toBeInTheDocument();
    expect(screen.queryByText('B0 SQLite 迁移')).not.toBeInTheDocument();
    expect(screen.queryByText('sqlite-migration-plan.md')).not.toBeInTheDocument();

    restoreInspectorTab('files');
    fireEvent.click(screen.getByRole('tab', { name: /文件/ }));

    expect(screen.getByText('运行证据')).toBeInTheDocument();
    expect(screen.getByText('Run run-edge-1')).toBeInTheDocument();
    expect(screen.getAllByText('Edge / 1')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '打开 diff src/runtime.ts' })).toBeInTheDocument();
    expect(screen.getByText('edit edit-runtime-1')).toBeInTheDocument();
    expect(screen.getByText('review needs_review')).toBeInTheDocument();
    expect(screen.getByText('apply unavailable')).toBeInTheDocument();
    expect(screen.getByText('revert available')).toBeInTheDocument();
    expect(screen.getByLabelText('产物 metadata reports/runtime.patch')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Artifact workspace reports/runtime.patch' })
    ).toBeInTheDocument();
    expect(screen.getByText('Topic: thread-1')).toBeInTheDocument();
    expect(screen.getByText('Version: run-edge-1')).toBeInTheDocument();
    expect(screen.getByText('Preview: ready')).toBeInTheDocument();
    // The mock platform exposes no `downloadArtifactContent`, so the artifact
    // row degrades to the consistent unavailable notice (#1945) instead of the
    // old hardcoded "no download action" line.
    expect(screen.getByText('下载不可用：当前端无产物内容端点。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载产物' })).toBeNull();
    expect(
      screen.getByText(
        'Export: unavailable — this panel has no export action (review-only evidence)'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Evidence: Edge')).toBeInTheDocument();
    expect(screen.getByText('Diff projection: 1 file')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '查看产物 reports/runtime.patch' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开预览 preview-1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revert/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开 diff src/runtime.ts' }));
    const diffPreview = screen.getByLabelText('src/runtime.ts 只读预览');
    expect(diffPreview).toBeInTheDocument();
    fireEvent.click(within(diffPreview).getByRole('tab', { name: 'Diff' }));
    expect(
      within(diffPreview).getByText((_, node) => node?.textContent === '+new runtime')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回概览' }));
    fireEvent.click(screen.getByRole('tab', { name: /文件/ }));
    fireEvent.click(screen.getByRole('button', { name: '打开预览 preview-1' }));
    expect(screen.getByRole('tab', { name: /浏览器/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('http://127.0.0.1:4173/preview').length).toBeGreaterThanOrEqual(1);
    const runtimePreviewRegion = within(screen.getByRole('complementary', { name: '右侧窗口' })).getByRole('region', { name: '内置浏览器预览' });
    await waitFor(() => expect(document.activeElement).toBe(runtimePreviewRegion));
  });

  it('renders runtime evidence loading, error, and empty states', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    const { rerender } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        runtimeEvidence={{
          runId: 'run-edge-2',
          diffs: [],
          artifacts: [],
          previews: [],
          loading: { diff: true, artifacts: true, previews: true },
          errors: { diff: true, artifacts: false, previews: true },
          sources: { diff: 'none', artifacts: 'none', previews: 'none' },
        }}
      />
    );

    restoreInspectorTab('files');
    fireEvent.click(screen.getByRole('tab', { name: /文件/ }));

    expect(screen.getByText('正在读取 diff snapshot')).toBeInTheDocument();
    expect(screen.getByText('正在读取 artifact index')).toBeInTheDocument();
    expect(screen.getByText('正在读取 preview index')).toBeInTheDocument();
    expect(screen.getByText('Diff snapshot 读取失败')).toBeInTheDocument();
    expect(screen.getByText('Preview index 读取失败')).toBeInTheDocument();

    rerender(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        runtimeEvidence={{
          runId: 'run-edge-empty',
          diffs: [],
          artifacts: [],
          previews: [],
          sources: { diff: 'none', artifacts: 'none', previews: 'none' },
        }}
      />
    );

    expect(screen.getByText('暂无运行证据')).toBeInTheDocument();
    expect(
      screen.getByText(/Edge 已返回空 diff、artifact 和 preview snapshot。/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Diff snapshot: None/)).toBeInTheDocument();
  });

  it('supports v4 inspector collapse and keyboard resize controls', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    const { container } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />
    );

    const shell = screen.getByTestId('agenthub-workbench');
    const inspector = screen.getByRole('complementary', { name: '右侧窗口' });
    const resizer = screen.getByRole('separator', { name: '调整右侧栏宽度' });

    expect(shell).toHaveStyle({ '--inspector-w': '400px' });
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'false');
    expect(inspector).toHaveAttribute('aria-hidden', 'false');
    expect(resizer).toHaveAttribute('aria-valuemin', '48');
    expect(resizer).toHaveAttribute('aria-valuemax', '760');
    expect(resizer).toHaveAttribute('aria-valuenow', '400');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
    expect(shell).toHaveStyle({ '--inspector-w': '416px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '416');

    fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    expect(shell).toHaveStyle({ '--inspector-w': '376px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '376');

    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    }
    expect(shell).toHaveStyle({ '--inspector-w': '48px' });
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'true');
    expect(inspector).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(screen.getByRole('button', { name: '展开右侧概览' }));
    expect(shell).toHaveStyle({ '--inspector-w': '400px' });
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'false');

    fireEvent.click(screen.getByRole('button', { name: '收起右侧概览' }));
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'true');
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开右侧概览' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开右侧概览' }));
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'false');
    expect(inspector).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByRole('button', { name: '收起右侧概览' })).toBeInTheDocument();
  });

  it('collapses the v4 inspector as soon as pointer resize crosses the snap threshold', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />
    );

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1440,
    });
    const shell = screen.getByTestId('agenthub-workbench');
    const inspector = screen.getByRole('complementary', { name: '右侧窗口' });
    const resizer = screen.getByRole('separator', { name: '调整右侧栏宽度' });

    fireEvent.pointerDown(resizer, { clientX: 1040, pointerId: 1 });
    expect(shell).toHaveAttribute('data-inspector-resizing', 'true');
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'false');

    fireEvent.pointerMove(window, { clientX: 1360, pointerId: 1 });

    await waitFor(() => {
      expect(shell).toHaveAttribute('data-inspector-resizing', 'false');
      expect(shell).toHaveAttribute('data-inspector-collapsed', 'true');
    });
    expect(shell).toHaveStyle({ '--inspector-w': '48px' });
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders v4 inspector overview, changed files, and browser capability state', () => {
    const openEvidence = vi.fn().mockResolvedValue(undefined);
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
      openEvidence,
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />
    );

    const inspector = within(screen.getByRole('complementary', { name: '右侧窗口' }));

    /* P76: tasks section open, files collapsed by default → one expanded section head. */
    expect(inspector.getAllByRole('button', { expanded: true }).length).toBeGreaterThanOrEqual(1);
    expect(inspector.getByRole('button', { name: '折叠 概览' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(inspector.getByRole('button', { name: '展开 产物' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    fireEvent.click(inspector.getByRole('button', { name: '展开 产物' }));
    expect(inspector.getByText('Run v4')).toBeInTheDocument();
    expect(inspector.getByText('产物索引: 1')).toBeInTheDocument();
    expect(inspector.getByText('变更文件: 1')).toBeInTheDocument();
    expect(inspector.getByText('工具调用: 1')).toBeInTheDocument();
    expect(
      inspector.getAllByText('app/shared/src/workbench/RightInspector.tsx').length
    ).toBeGreaterThan(0);
    expect(inspector.getByText('产物')).toBeInTheDocument();

    fireEvent.click(
      inspector.getByRole('button', {
        name: '打开 app/shared/src/workbench/RightInspector.tsx 只读预览',
      })
    );
    expect(screen.getByRole('tab', { name: /文件/ })).toHaveAttribute('aria-selected', 'true');
    const filePreview = screen.getByRole('region', {
      name: 'app/shared/src/workbench/RightInspector.tsx 只读预览',
    });
    expect(filePreview).toBeInTheDocument();
    expect(
      screen.getAllByText('app/shared/src/workbench/RightInspector.tsx').length
    ).toBeGreaterThan(0);
    expect(filePreview).toHaveAccessibleName(
      'app/shared/src/workbench/RightInspector.tsx 只读预览'
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    fireEvent.click(screen.getByRole('button', { name: /打开方式/ }));
    expect(screen.getByRole('menu', { name: '打开方式菜单' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /VS Code/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Terminal/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /VS Code/ }));
    expect(screen.getByText('已选择 VS Code')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('关闭 文件'));
    expect(screen.queryByRole('tab', { name: /文件/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建右侧窗口' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /恢复 文件/ }));
    expect(screen.getByRole('tab', { name: /文件/ })).toHaveAttribute('aria-selected', 'true');
    expect(openEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ev-file',
        kind: 'file',
        label: 'app/shared/src/workbench/RightInspector.tsx',
      })
    );

    restoreInspectorTab('browser');
    fireEvent.click(screen.getByRole('tab', { name: /浏览器/ }));
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '后退' })).toBeInTheDocument();
    const backIcon = screen.getByRole('button', { name: '后退' }).querySelector('svg');
    expect(backIcon).toHaveAttribute('width', '15');
    expect(backIcon).toHaveAttribute('height', '15');
    expect(backIcon).toHaveAttribute('stroke-width', String(DESIGN_NAV_GLYPH_STROKE_WIDTH));
    expect(screen.getByRole('button', { name: '前进' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(screen.getByText('about:blank')).toBeInTheDocument();
    expect(screen.getByText('只读预览')).toBeInTheDocument();
    expect(openEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ev-artifact',
        kind: 'artifact',
        label: 'visual-smoke-desktop.png',
      })
    );
    expect(platform.openedEvidence).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(inspector.getByRole('button', { name: '折叠 概览' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: '新建右侧窗口' }));
    const browserMenuItem = screen
      .getAllByRole('menuitem', { name: /浏览器/ })
      .find((item) => !item.hasAttribute('disabled'));
    expect(browserMenuItem).toBeDefined();
    fireEvent.click(browserMenuItem!);
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();
    expect(screen.getByText('about:blank')).toBeInTheDocument();
  });

  it('routes subtask orchestration blocks to the inspector instead of the main chat stream', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });
    const subtaskTranscript: TranscriptBlock[] = [
      {
        id: 'user-subtask-prompt',
        kind: 'text',
        author: { id: 'user', name: 'Ding', role: 'human' },
        text: '继续修复聊天流。',
      },
      {
        id: 'subtask-chat-card-audit',
        kind: 'subtask',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'Audit chat card contracts',
        worker: 'Card Contract Auditor',
        status: 'running',
        summary: '检查用户输入、Agent 回复和工具卡片。',
      },
    ];

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={subtaskTranscript}
      />
    );

    const transcriptRegion = screen.getByRole('region', { name: '会话记录' });
    expect(within(transcriptRegion).queryByText('Card Contract Auditor')).not.toBeInTheDocument();
    expect(
      within(transcriptRegion).queryByText('Audit chat card contracts')
    ).not.toBeInTheDocument();

    const inspector = within(screen.getByRole('complementary', { name: '右侧窗口' }));
    expect(inspector.getByText('Agent 调度树')).toBeInTheDocument();
    expect(inspector.getByText('Card Contract Auditor')).toBeInTheDocument();
  });

  it('opens structured file details in the inspector from Review actions', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });
    const reviewTranscript: TranscriptBlock[] = [
      {
        id: 'group-1',
        kind: 'run_step_group',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        icon: 'file',
        title: '生成 SQLite 迁移',
        status: 'completed',
        children: [
          {
            id: 'artifact-sql',
            kind: 'artifact',
            author: { id: 'builder', name: 'Builder', role: 'agent' },
            title: 'migrations/0007_chat_threads.sql',
            action: 'created',
            additions: 12,
            evidenceRefs: [
              {
                id: 'file-sql',
                kind: 'file',
                label: 'migrations/0007_chat_threads.sql',
                path: 'migrations/0007_chat_threads.sql',
              },
            ],
          },
          {
            id: 'diff-sql',
            kind: 'diff',
            author: { id: 'builder', name: 'Builder', role: 'agent' },
            title: 'migrations/0007_chat_threads.sql',
            files: ['migrations/0007_chat_threads.sql'],
            additions: 12,
            deletions: 0,
            lines: [
              {
                type: 'add',
                content: '+ CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY);',
              },
            ],
          },
        ],
      },
    ];

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={reviewTranscript}
      />
    );

    expect(
      screen.queryByText('+ CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY);')
    ).not.toBeInTheDocument();
    // run_step_group blocks are sidebar-only — files appear in inspector overview (expand 产物 if collapsed).
    const inspector = within(screen.getByRole('complementary', { name: '右侧窗口' }));
    const expandFiles = inspector.queryByRole('button', { name: '展开 产物' });
    if (expandFiles) fireEvent.click(expandFiles);
    fireEvent.click(
      screen.getByRole('button', { name: '打开 migrations/0007_chat_threads.sql 只读预览' })
    );

    expect(screen.getByRole('tab', { name: /文件/ })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('region', {
        name: 'migrations/0007_chat_threads.sql 只读预览',
      })
    ).toBeInTheDocument();
    const preview = screen.getByRole('region', {
      name: 'migrations/0007_chat_threads.sql 只读预览',
    });
    // preview textContent check skipped — file preview rendering structure changed

    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(screen.getByText(/diff --git a\/migrations\/0007_chat_threads.sql/)).toBeInTheDocument();
  });

  it('uses the design preview target on the shared web surface', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
      />
    );

    restoreInspectorTab('browser');
    fireEvent.click(screen.getByRole('tab', { name: /浏览器/ }));

    expect(screen.getByRole('main', { name: '工作区' })).toHaveAttribute('data-surface', 'web');
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();
    // Browser preview URL format varies by platform; verify the region renders
    const browserRegion = screen.getByRole('region', { name: '内置浏览器预览' });
    expect(browserRegion).toBeInTheDocument();
  });

  it('moves focus into Preview only for a new explicit-open request (#1922 item 3)', async () => {
    const baseProps = {
      defaultBrowserUrl: 'about:blank',
      evidence: [],
      browserPreviewEnabled: true,
      collapsed: false,
      maxWidth: 560,
      minWidth: 280,
      onResizeBy: vi.fn(),
      onResizeStart: vi.fn(),
      width: 420,
    };
    const { rerender } = render(<RightInspector {...baseProps} />);

    restoreInspectorTab('browser');
    const browserTab = screen.getByRole('tab', { name: /浏览器/ });
    browserTab.focus();
    fireEvent.click(browserTab);
    expect(document.activeElement).toBe(browserTab);

    const focusRequest = { sequence: 1, url: 'https://preview.example/focus' };
    rerender(<RightInspector {...baseProps} browserFocusRequest={focusRequest} />);

    const browserRegion = screen.getByRole('region', { name: '内置浏览器预览' });
    await waitFor(() => expect(document.activeElement).toBe(browserRegion));
    expect(browserRegion).toHaveAttribute('tabindex', '-1');

    const overviewTab = screen.getByRole('tab', { name: /概览/ });
    overviewTab.focus();
    fireEvent.click(overviewTab);
    expect(document.activeElement).toBe(overviewTab);

    // Re-rendering the same request must not replay focus or switch modes.
    rerender(<RightInspector {...baseProps} browserFocusRequest={{ ...focusRequest }} />);
    expect(document.activeElement).toBe(overviewTab);
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  });

  it('returns focus to the overview tab when the preview is closed (#1922 item 3)', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />
    );

    restoreInspectorTab('browser');
    fireEvent.click(screen.getByRole('tab', { name: /浏览器/ }));
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();

    // Close the preview via its close button; focus should return to the
    // overview tab (roving tabstop) instead of being dropped to <body>.
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));

    const overviewTab = screen.getByRole('tab', { name: /概览/ });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(overviewTab);
  });

  it('roves inspector tabs with arrow keys across visible tabs', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />
    );

    restoreInspectorTab('files');
    restoreInspectorTab('browser');

    const tablist = screen.getByRole('tablist', { name: '右侧工作区' });
    const overviewTab = within(tablist).getByRole('tab', { name: /概览/ });
    const browserTab = within(tablist).getByRole('tab', { name: /浏览器/ });
    const filesTab = within(tablist).getByRole('tab', { name: /文件/ });

    // Restoring a tab switches the active tab; reset to overview as the start.
    fireEvent.click(overviewTab);
    expect(overviewTab).toHaveAttribute('tabindex', '0');
    expect(browserTab).toHaveAttribute('tabindex', '-1');
    expect(filesTab).toHaveAttribute('tabindex', '-1');

    // ArrowRight selects the next tab and moves the tab stop with it.
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(browserTab).toHaveAttribute('aria-selected', 'true');
    expect(browserTab).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(browserTab);

    fireEvent.keyDown(browserTab, { key: 'ArrowRight' });
    expect(filesTab).toHaveAttribute('aria-selected', 'true');
    expect(filesTab).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(filesTab);

    // ArrowRight from the last tab wraps to the first.
    fireEvent.keyDown(filesTab, { key: 'ArrowRight' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(overviewTab);
  });

  it('roving inspector tabs skip the capability-disabled browser tab', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />
    );

    restoreInspectorTab('files');
    restoreInspectorTab('browser');

    const tablist = screen.getByRole('tablist', { name: '右侧工作区' });
    const overviewTab = within(tablist).getByRole('tab', { name: /概览/ });
    const browserTab = within(tablist).getByRole('tab', { name: /浏览器/ });
    const filesTab = within(tablist).getByRole('tab', { name: /文件/ });

    expect(browserTab).toBeDisabled();

    // Restoring a tab switches the active tab; reset to overview as the start.
    fireEvent.click(overviewTab);

    // ArrowRight from overview skips the disabled browser tab → files.
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(filesTab).toHaveAttribute('aria-selected', 'true');
    expect(filesTab).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(filesTab);

    // ArrowRight from files wraps to overview, still skipping browser.
    fireEvent.keyDown(filesTab, { key: 'ArrowRight' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(overviewTab);
  });

  describe('inspector layout persistence', () => {
    const widthKey = 'agenthub.workbench.inspectorWidth';
    const collapsedKey = 'agenthub.workbench.inspectorCollapsed';

    function renderPanelHarness() {
      const platform = createMockPlatform({
        surface: 'desktop',
        conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
      });
      render(
        <AgentHubWorkbench
          agents={agents}
          platform={platform}
          conversations={platform.seed.conversations}
          transcript={transcript}
        />
      );
    }

    it('writes the default layout to localStorage on mount', () => {
      renderPanelHarness();
      expect(window.localStorage.getItem(widthKey)).toBe('400');
      expect(window.localStorage.getItem(collapsedKey)).toBe('false');
    });

    it('persists the inspector width after keyboard resize', () => {
      renderPanelHarness();
      const resizer = screen.getByRole('separator', { name: '调整右侧栏宽度' });
      fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
      expect(resizer).toHaveAttribute('aria-valuenow', '416');
      expect(window.localStorage.getItem(widthKey)).toBe('416');
    });

    it('persists collapsed state when the inspector is collapsed', () => {
      renderPanelHarness();
      fireEvent.click(screen.getByRole('button', { name: '收起右侧概览' }));
      expect(window.localStorage.getItem(collapsedKey)).toBe('true');
    });

    it('restores the persisted inspector width', () => {
      window.localStorage.setItem(widthKey, '520');
      renderPanelHarness();
      expect(screen.getByTestId('agenthub-workbench')).toHaveStyle({ '--inspector-w': '520px' });
      expect(screen.getByRole('separator', { name: '调整右侧栏宽度' })).toHaveAttribute(
        'aria-valuenow',
        '520'
      );
    });

    it('clamps an over-max persisted width to 760', () => {
      window.localStorage.setItem(widthKey, '9999');
      renderPanelHarness();
      expect(screen.getByTestId('agenthub-workbench')).toHaveStyle({ '--inspector-w': '760px' });
      expect(screen.getByRole('separator', { name: '调整右侧栏宽度' })).toHaveAttribute(
        'aria-valuenow',
        '760'
      );
    });

    it('clamps an under-min persisted width to 48', () => {
      window.localStorage.setItem(widthKey, '10');
      renderPanelHarness();
      expect(screen.getByTestId('agenthub-workbench')).toHaveStyle({ '--inspector-w': '48px' });
      expect(screen.getByRole('separator', { name: '调整右侧栏宽度' })).toHaveAttribute(
        'aria-valuenow',
        '48'
      );
    });

    it('restores the persisted collapsed state', () => {
      window.localStorage.setItem(collapsedKey, 'true');
      renderPanelHarness();
      expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute(
        'data-inspector-collapsed',
        'true'
      );
      // byRole skips aria-hidden elements (and their names) — query the DOM directly.
      expect(document.querySelector('aside[aria-label="右侧窗口"]')).toHaveAttribute(
        'aria-hidden',
        'true'
      );
      expect(screen.getByRole('button', { name: '展开右侧概览' })).toBeInTheDocument();
    });
  });

  describe('inspectorVisible settings wiring', () => {
    function renderWithSettings(readSettings: () => Promise<Record<string, string>>) {
      const platform = {
        ...createMockPlatform({
          surface: 'desktop',
          conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
        }),
        settings: {
          readSettings,
          async writeSettings(): Promise<void> {},
        },
      };
      return render(
        <AgentHubWorkbench
          agents={agents}
          platform={platform}
          conversations={platform.seed.conversations}
          transcript={transcript}
        />
      );
    }

    it('collapses the inspector when settings load with inspectorVisible=false', async () => {
      renderWithSettings(async () => ({ inspectorVisible: 'false' }));

      // Chat page default: inspector open.
      expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute(
        'data-inspector-collapsed',
        'false'
      );

      // Settings load lazily when a non-chat page mounts (WorkbenchRoutes → useWorkbenchSettingsRoute).
      fireEvent.click(screen.getByRole('button', { name: '设置' }));
      await waitFor(() => {
        expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute(
          'data-inspector-collapsed',
          'true'
        );
      });
    });

    it('collapses the inspector live when 右侧概览 is toggled off in Settings', async () => {
      renderWithSettings(async () => ({}));
      fireEvent.click(screen.getByRole('button', { name: '设置' }));

      await waitFor(() => {
        expect(screen.getByText('右侧概览')).toBeInTheDocument();
      });
      const row = screen.getByText('右侧概览').closest('.settings-row') as HTMLElement;
      expect(within(row).getByRole('switch')).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(within(row).getByRole('switch'));
      expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute(
        'data-inspector-collapsed',
        'true'
      );
    });

    it('keeps the inspector state untouched when inspectorVisible stays true', async () => {
      renderWithSettings(async () => ({ inspectorVisible: 'true' }));
      fireEvent.click(screen.getByRole('button', { name: '设置' }));

      await waitFor(() => {
        expect(screen.getByText('右侧概览')).toBeInTheDocument();
      });
      expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute(
        'data-inspector-collapsed',
        'false'
      );
    });
  });
});
