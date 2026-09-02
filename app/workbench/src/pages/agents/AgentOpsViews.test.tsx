import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../__tests__/setup';
import {
  AgentPolicyView,
  AgentToolsView,
  AgentModelsView,
  AgentAuditView,
} from './AgentOpsViews';
import { AuditEntriesSection } from './AgentOpsParts';
import type { AgentsPageProps, AuditEntry } from './types';

// Ops empty-state copy resolves via the sharedWorkbench namespace after
// the #2007 i18n convergence; opt into the zh bundle (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

function baseProps(overrides: Partial<AgentsPageProps> = {}): AgentsPageProps {
  return {
    activePane: 'policy',
    onPaneChange: () => undefined,
    installedCount: 0,
    runnableCount: 0,
    confirmCount: 0,
    defaultModelLabel: '—',
    agents: [],
    ...overrides,
  };
}

describe('Agents ops views real-mode unavailable (#1872)', () => {
  it('shows unavailable state for policy matrix in real mode with no data', () => {
    render(<AgentPolicyView {...baseProps({ dataSource: 'real', policyRules: [] })} />);
    expect(screen.getByRole('region', { name: '策略数据当前不可用' })).toBeInTheDocument();
  });

  it('renders the policy matrix instead of unavailable in demo mode', () => {
    render(<AgentPolicyView {...baseProps({ dataSource: 'demo', policyRules: [] })} />);
    expect(screen.queryByRole('region', { name: '策略数据当前不可用' })).not.toBeInTheDocument();
  });

  it('shows unavailable state for tool matrix in real mode with no agents', () => {
    render(<AgentToolsView {...baseProps({ dataSource: 'real', toolMatrixAgents: [] })} />);
    expect(screen.getByRole('region', { name: '工具权限矩阵当前不可用' })).toBeInTheDocument();
  });

  it('renders the tool matrix instead of unavailable in demo mode', () => {
    render(<AgentToolsView {...baseProps({ dataSource: 'demo', toolMatrixAgents: [] })} />);
    expect(screen.queryByRole('region', { name: '工具权限矩阵当前不可用' })).not.toBeInTheDocument();
  });

  it('shows unavailable state for model health in real mode with no rows', () => {
    render(<AgentModelsView {...baseProps({ dataSource: 'real', models: [], modelRoutes: [], modelHealthRows: [] })} />);
    expect(screen.getByRole('region', { name: '模型健康数据当前不可用' })).toBeInTheDocument();
  });

  it('renders the model health section instead of unavailable in demo mode', () => {
    render(<AgentModelsView {...baseProps({ dataSource: 'demo', models: [], modelRoutes: [], modelHealthRows: [] })} />);
    expect(screen.queryByRole('region', { name: '模型健康数据当前不可用' })).not.toBeInTheDocument();
  });

  it('shows unavailable state for audit entries in real mode with no rows', () => {
    render(<AgentAuditView {...baseProps({ dataSource: 'real', auditEntries: [] })} />);
    expect(screen.getByRole('region', { name: '审计日志当前不可用' })).toBeInTheDocument();
  });

  it('renders the audit entries section instead of unavailable in demo mode', () => {
    render(<AgentAuditView {...baseProps({ dataSource: 'demo', auditEntries: [] })} />);
    expect(screen.queryByRole('region', { name: '审计日志当前不可用' })).not.toBeInTheDocument();
  });
});

/* #2154 P2-16: the audit page mixed three paradigms — the export button
   correctly hid itself when unwired, the filter chips looked clickable and did
   nothing, and every row was a focusable <button> with no onClick. Chips and
   rows now follow the export button's rule. */
describe('AgentAuditView interaction honesty (#2154 P2-16)', () => {
  const entry: AuditEntry = {
    time: '10:00',
    agent: 'Builder',
    tool: 'shell',
    result: '允许',
    target: 'agenthub-repo',
  };
  const demoWithEntries = { dataSource: 'demo' as const, auditEntries: [entry] };

  it('disables every filter chip when no onAuditFilterChange is wired', () => {
    render(<AgentAuditView {...baseProps(demoWithEntries)} />);

    for (const label of ['全部', '需确认', '禁止', '今天']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
  });

  it('enables the chips and forwards the filter id once a handler is wired', () => {
    const onAuditFilterChange = vi.fn();
    render(<AgentAuditView {...baseProps({ ...demoWithEntries, onAuditFilterChange })} />);

    const chip = screen.getByRole('button', { name: '需确认' });
    expect(chip).toBeEnabled();
    fireEvent.click(chip);
    expect(onAuditFilterChange).toHaveBeenCalledWith('需确认');
  });

  it('renders audit rows as plain content when there is no row handler', () => {
    render(<AgentAuditView {...baseProps(demoWithEntries)} />);

    expect(screen.getByText('Builder')).toBeInTheDocument();
    // No button semantics → no hover/focus affordance promising an action.
    expect(screen.queryByRole('button', { name: /Builder/ })).not.toBeInTheDocument();
  });

  it('keeps hiding the export button without a handler', () => {
    render(<AgentAuditView {...baseProps(demoWithEntries)} />);

    expect(screen.queryByRole('button', { name: '导出日志' })).not.toBeInTheDocument();
  });

  it('renders rows as buttons and forwards the entry when a handler is wired', () => {
    const onAuditRowClick = vi.fn();
    render(<AuditEntriesSection auditEntries={[entry]} onAuditRowClick={onAuditRowClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Builder/ }));
    expect(onAuditRowClick).toHaveBeenCalledWith(entry);
  });
});
