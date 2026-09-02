/* ═══════════════════════════════════════════════════════════════════════
   AgentMarketViews — Skill/MCP market error prop wiring (#1821).

   AgentMarketParts accepted `skillMarketError`/`mcpMarketError` all along,
   but neither shell passed them, so a failed market query collapsed into a
   blank "nothing published" empty state. The views must forward the error
   so the market shows its honest error copy instead.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../__tests__/setup';
import { MCPMarketView, SkillMarketView } from './AgentMarketViews';
import type { AgentsPageProps } from './types';

// Market empty-state / action copy resolves via the sharedWorkbench
// namespace after the #2007 i18n convergence; opt into the zh bundle of
// the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

function baseProps(overrides: Partial<AgentsPageProps> = {}): AgentsPageProps {
  return {
    activePane: 'skillMarket',
    onPaneChange: () => undefined,
    ...overrides,
  };
}

describe('SkillMarketView error state (#1821)', () => {
  it('shows the error empty state when the skill market query failed', () => {
    render(<SkillMarketView {...baseProps({
      skillMarketItems: [],
      skillMarketLoading: false,
      skillMarketError: 'GET /skills 500',
    })} />);

    expect(screen.getByText('Skill 市场暂时不可用')).toBeInTheDocument();
    expect(screen.getByText('公共 Skill 列表加载失败。恢复后可重试浏览与安装。')).toBeInTheDocument();
    // The honest error replaces the "nothing published" blank copy.
    expect(screen.queryByText('暂无公共 Skill')).not.toBeInTheDocument();
  });

  it('keeps the blank empty state when the query succeeded with no items', () => {
    render(<SkillMarketView {...baseProps({
      skillMarketItems: [],
      skillMarketLoading: false,
    })} />);

    expect(screen.getByText('暂无公共 Skill')).toBeInTheDocument();
    expect(screen.queryByText('Skill 市场暂时不可用')).not.toBeInTheDocument();
  });
});

describe('MCPMarketView error state (#1821)', () => {
  it('shows the error empty state when the MCP market query failed', () => {
    render(<MCPMarketView {...baseProps({
      activePane: 'mcpMarket',
      mcpMarketItems: [],
      mcpMarketLoading: false,
      mcpMarketError: 'GET /mcp-servers 500',
    })} />);

    expect(screen.getByText('MCP 市场暂时不可用')).toBeInTheDocument();
    expect(screen.getByText('公共 MCP 列表加载失败。恢复后可重试浏览与安装。')).toBeInTheDocument();
    expect(screen.queryByText('暂无公共 MCP Server')).not.toBeInTheDocument();
  });

  it('keeps the blank empty state when the query succeeded with no items', () => {
    render(<MCPMarketView {...baseProps({
      activePane: 'mcpMarket',
      mcpMarketItems: [],
      mcpMarketLoading: false,
    })} />);

    expect(screen.getByText('暂无公共 MCP Server')).toBeInTheDocument();
    expect(screen.queryByText('MCP 市场暂时不可用')).not.toBeInTheDocument();
  });
});

describe('Skill/MCP market install unavailable (#1872)', () => {
  it('disables skill install action when no onSkillInstall handler is wired', () => {
    render(<SkillMarketView {...baseProps({
      skillMarketItems: [{ id: 's1', name: 'code-review', description: 'review diffs', skill_type: 'tool' }],
      skillMarketLoading: false,
    })} />);
    expect(screen.getByRole('button', { name: '安装' })).toBeDisabled();
  });

  it('enables skill install action when a handler is wired', () => {
    render(<SkillMarketView {...baseProps({
      skillMarketItems: [{ id: 's1', name: 'code-review', description: 'review diffs', skill_type: 'tool' }],
      skillMarketLoading: false,
      onSkillInstall: vi.fn(),
    })} />);
    expect(screen.getByRole('button', { name: '安装' })).toBeEnabled();
  });

  it('disables MCP install action when no onMcpInstall handler is wired', () => {
    render(<MCPMarketView {...baseProps({
      activePane: 'mcpMarket',
      mcpMarketItems: [{ id: 'm1', name: 'gh', description: 'github mcp', transport: 'stdio' }],
      mcpMarketLoading: false,
    })} />);
    expect(screen.getByRole('button', { name: '安装' })).toBeDisabled();
  });
});

/* #2154 P1-1: the three market toolbars share MarketFilterToolbar, and the
   shells never pass a search handler — the box looked editable and dropped
   every keystroke. Same gate as the install buttons above (#1872). */
describe('Market toolbar search gate (#2154 P1-1)', () => {
  it('disables the Skill market search box when no search handler is wired', () => {
    render(<SkillMarketView {...baseProps({ skillMarketLoading: false })} />);

    const input = screen.getByPlaceholderText('搜索 Skill 名称或描述');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('title', '该搜索框还没有接入数据源，暂时不可用。');
  });

  it('enables the Skill market search box and forwards keystrokes once wired', () => {
    const onSkillMarketSearchChange = vi.fn();
    render(<SkillMarketView {...baseProps({
      skillMarketLoading: false,
      onSkillMarketSearchChange,
    })} />);

    const input = screen.getByPlaceholderText('搜索 Skill 名称或描述');
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute('title');

    fireEvent.change(input, { target: { value: 'review' } });
    expect(onSkillMarketSearchChange).toHaveBeenCalledWith('review');
  });

  it('disables the MCP market search box through the same shared toolbar', () => {
    render(<MCPMarketView {...baseProps({
      activePane: 'mcpMarket',
      mcpMarketLoading: false,
    })} />);

    expect(screen.getByPlaceholderText('搜索 MCP Server 名称或描述')).toBeDisabled();
  });
});
