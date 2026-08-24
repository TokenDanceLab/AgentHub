import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '../../__tests__/setup';
import {
  AgentPolicyView,
  AgentToolsView,
  AgentModelsView,
  AgentAuditView,
} from './AgentOpsViews';
import type { AgentsPageProps } from './types';

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
