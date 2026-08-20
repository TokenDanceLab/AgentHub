/**
 * Shared setup for the AgentHubWorkbench integration test shards (#1763).
 *
 * Every shard MUST import this module before importing the workbench
 * component tree: the vi.mock factories below have to be registered before
 * `AgentHubWorkbench` and its transitive dependencies (virtua,
 * @lobehub/icons) are evaluated.
 */
import React from 'react';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

// Workbench chrome + transcript copy resolve through the shared test
// i18next instance; opt into the zh bundle for this suite (Issue #1717).
import { useTestI18nLanguage } from '../../testing/i18n';

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

vi.mock('@lobehub/icons', () => {
  const span = () => null;
  return {
    Alibaba: span,
    AlibabaCloud: span,
    Anthropic: span,
    Azure: span,
    Aws: span,
    Bedrock: span,
    ByteDance: span,
    Claude: span,
    ClaudeCode: span,
    Codex: span,
    Cohere: span,
    DeepSeek: span,
    Doubao: span,
    Gemini: span,
    GeminiCLI: span,
    Google: span,
    Meta: span,
    Mistral: span,
    ModelIcon: span,
    Moonshot: span,
    OpenCode: span,
    OpenAI: span,
    Perplexity: span,
    ProviderIcon: span,
    Qwen: span,
    Volcengine: span,
    Zhipu: span,
  };
});
vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: () => null }));

vi.mock('@lobehub/icons/es/Alibaba', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/AlibabaCloud', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Anthropic', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Azure', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Aws', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Bedrock', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/ByteDance', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Claude', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/ClaudeCode', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Codex', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Cohere', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/DeepSeek', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Doubao', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Gemini', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/GeminiCLI', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Google', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Meta', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Mistral', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Moonshot', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/OpenAI', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/OpenCode', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Perplexity', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Qwen', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Volcengine', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Zhipu', () => ({ default: () => null }));

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
  });
}

/** P76: inspector tabs beyond overview open on demand via + menu. */
export function restoreInspectorTab(mode: 'files' | 'browser'): void {
  fireEvent.click(screen.getByRole('button', { name: '新建右侧窗口' }));
  const menu = screen.getByRole('menu', { name: '右侧窗口菜单' });
  const restoreLabel = mode === 'files' ? /恢复 文件/ : /恢复 浏览器/;
  fireEvent.click(within(menu).getByRole('menuitem', { name: restoreLabel }));
}
