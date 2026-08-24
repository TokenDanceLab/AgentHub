/* ═══════════════════════════════════════════════════════════════════════
   AgentInstalledViews — first-load skeleton + i18n empty-state copy.

   Covers the #5/#6 UIUX gap: loading rows while the list is fetching and
   translation-driven empty copy instead of hardcoded Chinese strings.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '../../__tests__/setup';
import { AgentInstalledView } from './AgentInstalledViews';
import type { AgentConfig, AgentsPageProps } from './types';

// Empty-state copy resolves via the sharedWorkbench namespace; opt into the
// zh bundle of the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

function baseProps(overrides: Partial<AgentsPageProps> = {}): AgentsPageProps {
  return {
    activePane: 'installed',
    onPaneChange: () => undefined,
    installedCount: 0,
    runnableCount: 0,
    confirmCount: 0,
    defaultModelLabel: '—',
    agents: [],
    ...overrides,
  };
}

function agent(id: string, name: string): AgentConfig {
  return {
    id,
    name,
    role: 'assistant',
    engine: 'v2',
    provider: 'anthropic',
    model: 'claude-sonnet',
    mode: 'auto',
    approval: '允许',
    scope: 'read',
    state: 'ready',
    skills: [],
    tools: {},
  };
}

// 3 rows x 5 bars (avatar, name block with 2 lines, model line, state dot)
const SKELETON_BAR_COUNT = 15;

describe('AgentInstalledView loading skeleton', () => {
  it('renders skeleton rows instead of the empty state while first-loading', () => {
    const { container } = render(
      <AgentInstalledView {...baseProps({ agentsLoading: true })} />,
    );

    const skeleton = screen.getByTestId('agent-list-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton.querySelectorAll('[aria-busy="true"]')).toHaveLength(SKELETON_BAR_COUNT);
    expect(screen.queryByRole('region', { name: '暂无已安装 Agent' })).not.toBeInTheDocument();
    // sanity: the skeleton div itself is aria-hidden so screen readers skip it
    expect(container.querySelector('[data-testid="agent-list-skeleton"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('renders no skeleton once loading settles with an empty list', () => {
    render(<AgentInstalledView {...baseProps()} />);

    expect(screen.queryByTestId('agent-list-skeleton')).not.toBeInTheDocument();
  });

  it('keeps the recovery panel over the skeleton while loading with an error', () => {
    render(
      <AgentInstalledView {...baseProps({ agentsLoading: true, agentsError: 'hub down' })} />,
    );

    expect(screen.queryByTestId('agent-list-skeleton')).not.toBeInTheDocument();
    // busy=true flips the retry label to its busy copy
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
  });
});

describe('AgentInstalledView empty copy', () => {
  it('renders the i18n agents.empty copy with the add CTA wired', () => {
    const onAgentAdd = vi.fn();
    render(
      <AgentInstalledView {...baseProps({ onAgentAdd })} />,
    );

    const emptyState = screen.getByRole('region', { name: '暂无已安装 Agent' });
    expect(emptyState).toBeInTheDocument();
    expect(within(emptyState).getByText('当前 Hub 账号还没有已安装配置。')).toBeInTheDocument();
    expect(within(emptyState).getByRole('button', { name: '添加 Agent' })).toBeInTheDocument();
  });
});

describe('AgentInstalledView with agents', () => {
  it('renders installed agent rows once data arrives', () => {
    render(
      <AgentInstalledView
        {...baseProps({
          agents: [agent('a1', 'Alpha'), agent('a2', 'Beta')],
          installedCount: 2,
          runnableCount: 2,
        })}
      />,
    );

    // Alpha is also selected (default first agent) so the edit panel repeats it
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta').length).toBe(1);
    expect(screen.queryByRole('region', { name: '暂无已安装 Agent' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-list-skeleton')).not.toBeInTheDocument();
  });
});

describe('AgentInstalledView no-handler controls (#1872)', () => {
  it('hides the add-agent header action when no onAgentAdd handler is wired', () => {
    render(<AgentInstalledView {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /添加 Agent/ })).not.toBeInTheDocument();
  });

  it('shows the add-agent header action only when a handler is provided', () => {
    render(
      <AgentInstalledView {...baseProps({ agents: [agent('a1', 'Alpha')], onAgentAdd: vi.fn() })} />,
    );
    expect(screen.getByRole('button', { name: /添加 Agent/ })).toBeInTheDocument();
  });

  it('disables skill chips / tool permissions / edit actions when handlers are missing', () => {
    render(
      <AgentInstalledView
        {...baseProps({
          agents: [agent('a1', 'Alpha')],
          allSkills: ['code-review', 'security-audit'],
          allTools: ['bash', 'git'],
        })}
      />,
    );

    for (const skill of ['code-review', 'security-audit']) {
      const chip = screen.getByRole('button', { name: new RegExp(skill) });
      expect(chip).toBeDisabled();
    }
    // each tool exposes 允许/需确认/禁止 permission buttons
    for (const label of ['允许', '需确认', '禁止']) {
      for (const btn of screen.getAllByRole('button', { name: label })) {
        expect(btn).toBeDisabled();
      }
    }
    expect(screen.getByRole('button', { name: /保存配置/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /复制 Agent/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /删除/ })).toBeDisabled();
  });
});
