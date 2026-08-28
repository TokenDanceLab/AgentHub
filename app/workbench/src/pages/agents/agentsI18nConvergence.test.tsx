/* ═══════════════════════════════════════════════════════════════════════
   Agents page i18n convergence (#2007) — English locale rendering.

   First-batch wired surfaces must render natural English copy under the
   en bundle of the shared test i18next instance (Issue #1717): at least
   one key assertion per wired file.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '../../__tests__/setup';
import { AgentMarketView, MCPMarketView, SkillMarketView } from './AgentMarketViews';
import { MarketFeaturedSection } from './AgentMarketParts';
import {
  AgentPolicyView,
  AgentToolsView,
  AgentModelsView,
  AgentAuditView,
} from './AgentOpsViews';
import { AgentAvatar } from './AgentInstalledParts';
import { AgentInstalledView } from './AgentInstalledViews';
import {
  AgentCapabilityStrip,
  AgentEditActions,
  AgentEditGrid,
  AgentMcpMemorySection,
  AgentMiniLog,
  AgentSkillChipGrid,
  AgentToolPermissions,
} from './AgentEditItemParts';
import { DataSourceBadge } from './DataSourceBadge';
import { AgentsPage } from '../AgentsPage';
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

describe('AgentsPage nav en copy (#2015)', () => {
  it('renders nav labels and captions in English', () => {
    render(<AgentsPage {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Installed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agent marketplace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skill market' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MCP market' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execution policy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tool permissions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Model configuration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.getByText('Recent changes')).toBeInTheDocument();
  });
});

describe('AgentInstalledViews en copy (#2015)', () => {
  it('renders head subcopy, stats strip, section head, and row details in English', () => {
    render(
      <AgentInstalledView
        {...baseProps({
          agents: [
            agent('a1', 'Alpha', { targetPreference: 'cloud' }),
            agent('a2', 'Beta'),
          ],
          installedCount: 2,
          runnableCount: 1,
          confirmCount: 0,
          defaultModelLabel: 'claude-sonnet',
        })}
      />,
    );
    expect(
      screen.getByText('Manage installed agent configurations, skills, and tool permissions.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Configuration profiles')).toBeInTheDocument();
    expect(screen.getByText('Ready / running')).toBeInTheDocument();
    expect(screen.getByText('Tool gating')).toBeInTheDocument();
    expect(screen.getByText('Model routing')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Installed' })).toBeInTheDocument();
    expect(screen.getByText('2 total')).toBeInTheDocument();
    expect(screen.getByText('Target: cloud')).toBeInTheDocument();
    expect(screen.getByText('No skills configured')).toBeInTheDocument();
  });

  it('renders the recovery panel in English when the agent list fails to load', () => {
    render(
      <AgentInstalledView
        {...baseProps({ agents: [], agentsError: 'GET /agents 500', onAgentsRetry: vi.fn() })}
      />,
    );
    expect(screen.getByText('Recovery')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Failed to load agents' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Could not read installed configurations from the current Hub. The list is temporarily unavailable; retry syncing.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the syncing section state and head add action in English', () => {
    render(
      <AgentInstalledView
        {...baseProps({ agents: [], agentsLoading: true, onAgentAdd: vi.fn() })}
      />,
    );
    expect(screen.getByText('Syncing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add agent' })).toBeInTheDocument();
  });
});

describe('AgentMarketViews en copy (#2015)', () => {
  it('renders market head subcopy and publish action in English', () => {
    render(
      <AgentMarketView
        {...baseProps({ activePane: 'market', onMarketPublish: vi.fn() })}
      />,
    );
    expect(
      screen.getByText(
        'Install reusable agents from the TokenDance template library without affecting installed configurations.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish template' })).toBeInTheDocument();
  });

  it('renders the skill market head in English', () => {
    render(<SkillMarketView {...baseProps({ activePane: 'skillMarket' })} />);
    expect(screen.getByRole('heading', { name: 'Skill market' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Browse public skills and install them to the current agent profile with one click. Installed skills can be uninstalled at any time.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the MCP market head in English', () => {
    render(<MCPMarketView {...baseProps({ activePane: 'mcpMarket' })} />);
    expect(screen.getByRole('heading', { name: 'MCP market' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Browse public MCP servers and install them to an agent profile to extend tool capabilities. Supports stdio, HTTP, and SSE transports.',
      ),
    ).toBeInTheDocument();
  });
});

describe('AgentEditItemParts en copy (#2015)', () => {
  it('renders edit grid field labels and placeholder in English', () => {
    render(<AgentEditGrid agent={agent('a1', 'Alpha')} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('Default model')).toBeInTheDocument();
    expect(screen.getByText('Run mode')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Approval policy')).toBeInTheDocument();
    expect(screen.getByText('Target preference')).toBeInTheDocument();
    expect(screen.getByText('Context scope')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('Not set').length).toBeGreaterThan(0);
  });

  it('renders edit action buttons in English', () => {
    render(
      <AgentEditActions
        isBusy={false}
        isSaving={false}
        isDeleting={false}
        onAgentSave={() => undefined}
        onAgentDuplicate={() => undefined}
        onAgentDelete={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate agent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renders capability strip labels, aria, and readiness in English', () => {
    render(
      <AgentCapabilityStrip
        agent={agent('a1', 'Alpha')}
        capabilitySummary={{
          agentsMd: 'ok',
          skills: 'ok',
          mcp: '\u2014',
          memory: '\u2014',
          tools: 'ok',
          avatar: '\u2014',
          readiness: 'ready',
        }}
      />,
    );
    expect(screen.getByLabelText('Capability readiness of Alpha')).toBeInTheDocument();
    expect(screen.getByText('Workspace doc')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('renders mcp/memory and skill sections in English', () => {
    render(<AgentMcpMemorySection agent={agent('a1', 'Alpha')} />);
    expect(screen.getByRole('heading', { name: 'MCP / memory' })).toBeInTheDocument();
    expect(screen.getByText('Policy pending')).toBeInTheDocument();

    render(<AgentSkillChipGrid agent={agent('a1', 'Alpha')} allSkills={['frontend']} />);
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByText('0 enabled')).toBeInTheDocument();
  });

  it('renders mini log in English and keeps enum segment labels on the data plane', () => {
    render(<AgentMiniLog recentEvents={[]} />);
    expect(screen.getByRole('heading', { name: 'Recent runs' })).toBeInTheDocument();
    expect(screen.getByText('0 events')).toBeInTheDocument();

    render(<AgentToolPermissions agent={agent('a1', 'Alpha')} allTools={['shell']} />);
    expect(screen.getByRole('heading', { name: 'Tool permissions' })).toBeInTheDocument();
    // ToolPermission enum identifiers remain direct-display data (#2015 decision point).
    expect(screen.getByRole('button', { name: '\u5141\u8bb8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '\u9700\u786e\u8ba4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '\u7981\u6b62' })).toBeInTheDocument();
  });
});

describe('DataSourceBadge en copy (#2015)', () => {
  it('renders provenance pills in English', () => {
    const demo = render(<DataSourceBadge source="demo" />);
    expect(demo.container.querySelector('[data-data-source="demo"]')?.textContent).toBe('Demo data');
    const unavailable = render(<DataSourceBadge source="unavailable" />);
    expect(
      unavailable.container.querySelector('[data-data-source="unavailable"]')?.textContent,
    ).toBe('Currently unavailable');
  });
});
