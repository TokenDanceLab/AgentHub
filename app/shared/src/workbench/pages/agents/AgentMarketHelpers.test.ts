import { describe, expect, it } from 'vitest';
import {
  compactEmptyStateClassNames,
  filterAgentMarketItems,
  filterMcpMarketItems,
  filterSkillMarketItems,
  formatMarketRuntimeStack,
  formatMarketTemplateListMeta,
  formatMcpMarketMeta,
  formatSkillMarketMeta,
  marketCountLabel,
  marketFilterLabel,
  resolveMarketEmptyKind,
  resolveMarketRuntimeName,
} from './AgentMarketHelpers';
import type { MarketTemplate } from './types';

const baseTemplate: MarketTemplate = {
  name: 'Reviewer',
  description: 'PR review agent',
  category: '研发',
  detail: 'fixture detail',
};

describe('AgentMarketHelpers', () => {
  it('resolves runtime brand name with runtimeId > runtime > name priority', () => {
    expect(resolveMarketRuntimeName({ name: 'A', runtime: 'claude', runtimeId: 'claude-code' })).toBe(
      'claude-code',
    );
    expect(resolveMarketRuntimeName({ name: 'A', runtime: 'claude' })).toBe('claude');
    expect(resolveMarketRuntimeName({ name: 'A' })).toBe('A');
  });

  it('formats runtime stack and falls back to fixture', () => {
    expect(
      formatMarketRuntimeStack({ runtime: 'claude', provider: 'anthropic', model: 'opus' }),
    ).toBe('claude / anthropic / opus');
    expect(formatMarketRuntimeStack({ runtime: 'claude' })).toBe('claude');
    expect(formatMarketRuntimeStack({})).toBe('fixture');
  });

  it('formats full-template list meta with detail fallback', () => {
    expect(
      formatMarketTemplateListMeta({
        ...baseTemplate,
        runtime: 'claude',
        provider: 'anthropic',
        model: 'opus',
        mcpServers: ['github'],
        memorySummary: 'session',
      }),
    ).toBe('claude · anthropic · opus · github · session');

    expect(formatMarketTemplateListMeta(baseTemplate)).toBe('fixture detail');
  });

  it('formats skill and mcp install meta lines', () => {
    expect(formatSkillMarketMeta({ version: '1.2.0', install_count: 12 })).toBe(
      'v1.2.0 · 12 installs',
    );
    expect(formatSkillMarketMeta({})).toBe('');
    expect(formatSkillMarketMeta({ version: '2.0.0' })).toBe('v2.0.0');

    expect(formatMcpMarketMeta({ command: 'npx foo', install_count: 3 })).toBe(
      'npx foo · 3 installs',
    );
    expect(formatMcpMarketMeta({ url: 'https://mcp.example' })).toBe('https://mcp.example');
    expect(formatMcpMarketMeta({})).toBe('');
  });

  it('maps empty filter chips and loading counts', () => {
    expect(marketFilterLabel('')).toBe('全部');
    expect(marketFilterLabel('prompt')).toBe('prompt');
    expect(marketFilterLabel('', 'All')).toBe('All');

    expect(marketCountLabel(true, 0, 'skills')).toBe('加载中');
    expect(marketCountLabel(false, 4, 'skills')).toBe('4 skills');
    expect(marketCountLabel(false, 0, 'servers')).toBe('0 servers');
  });

  it('classifies empty results by error, search, filter, then blank priority', () => {
    expect(resolveMarketEmptyKind({ error: 'offline', searchQuery: 'builder', activeFilter: '研发' })).toBe('error');
    expect(resolveMarketEmptyKind({ searchQuery: 'builder', activeFilter: '研发' })).toBe('search');
    expect(resolveMarketEmptyKind({ searchQuery: '  ', activeFilter: '研发', defaultFilter: '推荐' })).toBe('filter');
    expect(resolveMarketEmptyKind({ searchQuery: '', activeFilter: '推荐', defaultFilter: '推荐' })).toBe('blank');
  });

  it('filters Agent, Skill, and MCP market rows by query and active chip', () => {
    expect(filterAgentMarketItems([baseTemplate], 'review', '推荐')).toEqual([baseTemplate]);
    expect(filterAgentMarketItems([baseTemplate], '', '测试')).toEqual([]);

    const skill = { id: 's1', name: 'Code Review', description: 'Review PRs', skill_type: 'workflow' };
    expect(filterSkillMarketItems([skill], 'prs', '')).toEqual([skill]);
    expect(filterSkillMarketItems([skill], '', 'tool')).toEqual([]);

    const mcp = { id: 'm1', name: 'GitHub', description: 'Repository tools', transport: 'http' };
    expect(filterMcpMarketItems([mcp], 'repo', '')).toEqual([mcp]);
    expect(filterMcpMarketItems([mcp], '', 'stdio')).toEqual([]);
  });

  it('packs compact EmptyState classNames without undefined spreads', () => {
    expect(compactEmptyStateClassNames({})).toEqual({});
    expect(
      compactEmptyStateClassNames({
        'agent-empty-compact': 'c',
        'agent-empty-compact-content': 'cc',
        'agent-empty-compact-title': 'ct',
        'agent-empty-compact-description': 'cd',
        'agent-empty-compact-action': 'ca',
      }),
    ).toEqual({
      className: 'c',
      contentClassName: 'cc',
      titleClassName: 'ct',
      descriptionClassName: 'cd',
      actionClassName: 'ca',
    });
    expect(
      compactEmptyStateClassNames({
        'agent-empty-compact': 'c',
        'agent-empty-compact-title': 'ct',
      }),
    ).toEqual({
      className: 'c',
      titleClassName: 'ct',
    });
  });
});
