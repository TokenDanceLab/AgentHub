/**
 * Shared setup for the AgentHubWorkbench integration test shards (#1763).
 *
 * Every shard MUST import this module before importing the workbench
 * component tree: the vi.mock factory below has to be registered before
 * `AgentHubWorkbench` and its transitive dependencies (virtua) are evaluated.
 */
import React from 'react';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

// Workbench chrome + transcript copy resolve through the shared test
// i18next instance; opt into the zh bundle for this suite (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

// jsdom has no layout engine, so virtua cannot measure the viewport/rows and
// would mount zero rows — breaking content-level queries on transcript cards.
// These tests cover workbench shell/transcript business logic, not
// virtualization, so a passthrough Virtualizer (render every child)
// preserves their semantics. The real Virtualizer is exercised by
// Transcript.autoscroll.test.tsx (scroll contract) and
// Transcript.virtualization.test.tsx (handle wiring).
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));


/**
 * Suite hooks mirroring the afterEach that wrapped every AgentHubWorkbench
 * test before the #1763 split. Call once at the top of each shard file.
 */
export function installWorkbenchTestHooks(): void {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    // Panel layout persistence keys — cleared so inspector width/collapsed
    // state written to localStorage by earlier tests cannot leak into later
    // mounts (useWorkbenchPanelLayout reads them in its state initializers).
    window.localStorage.removeItem('agenthub.workbench.inspectorWidth');
    window.localStorage.removeItem('agenthub.workbench.inspectorCollapsed');
    window.localStorage.removeItem('agenthub.workbench.engineeringColumnByConversation.v1');
  });
}

/** P76: inspector tabs beyond overview open on demand via + menu. */
export function restoreInspectorTab(mode: 'files' | 'browser'): void {
  fireEvent.click(screen.getByRole('button', { name: '新建右侧窗口' }));
  const menu = screen.getByRole('menu', { name: '右侧窗口菜单' });
  const restoreLabel = mode === 'files' ? /恢复 文件/ : /恢复 浏览器/;
  fireEvent.click(within(menu).getByRole('menuitem', { name: restoreLabel }));
}
