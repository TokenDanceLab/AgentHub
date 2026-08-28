/* ═══════════════════════════════════════════════════════════════════════
   Agents page i18n convergence (#2007) — English locale rendering.

   First-batch wired surfaces must render natural English copy under the
   en bundle of the shared test i18next instance (Issue #1717): at least
   one key assertion per wired file.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '../../__tests__/setup';
import { AgentMarketView, SkillMarketView } from './AgentMarketViews';
import { MarketFeaturedSection } from './AgentMarketParts';
import {
  AgentPolicyView,
  AgentToolsView,
  AgentModelsView,
  AgentAuditView,
} from './AgentOpsViews';
import { AgentAvatar } from './AgentInstalledParts';
import { AgentInstalledView } from './AgentInstalledViews';
import type { AgentConfig, AgentsPageProps } from './types';

import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
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

function agent(id: string, name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
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
    ...overrides,
  };
}

describe('AgentMarketParts en copy (#2007)', () => {
  it('renders featured section headings in English', () => {
    render(<MarketFeaturedSection marketFeatured={[]} />);
    expect(screen.getByRole('heading', { name: 'Featured templates' })).toBeInTheDocument();
    expect(screen.getByText('Curated')).toBeInTheDocument();
  });

  it('renders the skill market error empty state in English', () => {
    render(
      <SkillMarketView
        {...baseProps({
          activePane: 'skillMarket',
          skillMarketItems: [],
          skillMarketLoading: false,
          skillMarketError: 'GET /skills 500',
        })}
      />,
    );
    expect(screen.getByText('Skill market is temporarily unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('The public skill list failed to load. Retry browsing and installing once it recovers.'),
    ).toBeInTheDocument();
  });
});

describe('AgentMarketItemParts en copy (#2007)', () => {
  it('renders market card summary fallbacks and install action in English', () => {
    render(
      <AgentMarketView
        {...baseProps({
          activePane: 'market',
          marketTemplates: [],
          marketFeatured: [{ name: 'Reviewer', description: 'PR review', category: '研发', detail: 'fixture' }],
          onMarketInstall: vi.fn(),
          onMarketPreview: vi.fn(),
        })}
      />,
    );
    expect(screen.getAllByText('No skills declared').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No MCP servers bound').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
  });

  it('renders skill row install button in English', () => {
    render(
      <SkillMarketView
        {...baseProps({
          activePane: 'skillMarket',
          skillMarketItems: [{ id: 's1', name: 'code-review', description: 'review diffs', skill_type: 'tool' }],
          skillMarketLoading: false,
          onSkillInstall: vi.fn(),
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled();
  });
});

describe('AgentOpsViews en copy (#2007)', () => {
  it('renders the policy view head and unavailable state in English', () => {
    render(<AgentPolicyView {...baseProps({ activePane: 'policy', dataSource: 'real', policyRules: [] })} />);
    expect(screen.getByRole('heading', { name: 'Execution policy' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Policy data is currently unavailable' }),
    ).toBeInTheDocument();
  });

  it('renders the audit view head and export action in English', () => {
    render(
      <AgentAuditView
        {...baseProps({ activePane: 'audit', dataSource: 'demo', auditEntries: [], onAuditExport: vi.fn() })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export log' })).toBeInTheDocument();
  });
});

describe('AgentOpsParts en copy (#2007)', () => {
  it('renders policy matrix, approval flow, and tool legend in English', () => {
    render(
      <AgentPolicyView
        {...baseProps({
          activePane: 'policy',
          dataSource: 'demo',
          policyRules: [
            { name: 'shell guard', riskLevel: '高风险', action: '禁止', description: 'no shells' },
          ],
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Policy matrix' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Default approval flow' })).toBeInTheDocument();
    expect(screen.getByText('Auto-approve read-only actions')).toBeInTheDocument();
    expect(screen.getByText('Policy match order')).toBeInTheDocument();

    render(<AgentToolsView {...baseProps({ activePane: 'tools', dataSource: 'demo' })} />);
    expect(screen.getByText('Allowed: low-risk actions run directly')).toBeInTheDocument();
    expect(screen.getByText('Denied: tool calls are never dispatched')).toBeInTheDocument();
  });

  it('renders audit filter chips and table head in English', () => {
    render(
      <AgentAuditView
        {...baseProps({
          activePane: 'audit',
          dataSource: 'demo',
          auditEntries: [
            { time: '10:00', agent: 'Alpha', tool: 'shell', result: '允许', target: 'repo' },
          ],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs confirmation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Denied' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('Target')).toBeInTheDocument();
  });
});

describe('AgentOpsItemParts en copy (#2007)', () => {
  it('renders cc-switch status grid and badge in English', () => {
    render(
      <AgentModelsView
        {...baseProps({
          activePane: 'models',
          dataSource: 'demo',
          models: [],
          modelRoutes: [],
          modelHealthRows: [],
          ccSwitchStatus: { installed: true, routingActive: true, proxyPort: 8118, activeAppTypes: ['claude'] },
        })}
      />,
    );
    expect(screen.getByText('cc-switch transparent proxy')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Install status')).toBeInTheDocument();
    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.getByText('Routing status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Proxy port')).toBeInTheDocument();
    expect(screen.getByText('Active apps')).toBeInTheDocument();
  });
});

describe('AgentInstalledParts en copy (#2007)', () => {
  it('renders the avatar aria-label with interpolation in English', () => {
    render(<AgentAvatar agent={agent('a1', 'Alpha')} />);
    expect(screen.getByRole('button', { name: 'View profile of Alpha' })).toBeInTheDocument();
  });

  it('renders translated capability tags in the installed list', () => {
    render(
      <AgentInstalledView
        {...baseProps({ agents: [agent('a1', 'Alpha', { skills: ['frontend', 'testing'] })] })}
      />,
    );
    const list = screen.getByText('Front-end development');
    expect(list).toBeInTheDocument();
    expect(screen.getByText('Testing')).toBeInTheDocument();
  });
});
