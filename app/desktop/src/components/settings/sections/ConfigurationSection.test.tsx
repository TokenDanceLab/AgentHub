import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@shared/types';
import {
  buildDefaultAgentOptions,
  normalizeDefaultAgentValue,
  resolveAvailableDefaultAgentId,
} from '@/utils/defaultAgent';
import ConfigurationSection from './ConfigurationSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'codex',
    name: 'Codex',
    status: 'available',
    capabilities: {
      streaming: true,
      toolCalls: false,
      fileChanges: false,
      thinkingVisible: false,
      multiTurn: false,
      mcpIntegration: false,
      permissionHooks: false,
      subAgentSpawn: false,
    },
    ...overrides,
  };
}

describe('ConfigurationSection default agent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds selectable options from available local agents', () => {
    const agents = [
      makeAgent({ id: 'codex', name: 'Codex' }),
      makeAgent({ id: 'claude-a', name: 'Claude' }),
      makeAgent({ id: 'claude-b', name: 'Claude' }),
      makeAgent({ id: 'disabled', name: 'Disabled', status: 'unavailable' }),
      makeAgent({ id: 'setup', name: 'Setup', status: 'configuring' }),
    ];

    expect(normalizeDefaultAgentValue('Auto')).toBe('auto');
    expect(buildDefaultAgentOptions(agents, 'Auto select')).toEqual([
      ['auto', 'Auto select'],
      ['codex', 'Codex'],
      ['claude-a', 'Claude (claude-a)'],
      ['claude-b', 'Claude (claude-b)'],
    ]);
    expect(resolveAvailableDefaultAgentId('codex', agents)).toBe('codex');
    expect(resolveAvailableDefaultAgentId('disabled', agents)).toBeNull();
    expect(resolveAvailableDefaultAgentId('Auto', agents)).toBeNull();
  });

  it('stores the selected default agent from the configuration dropdown', () => {
    const setDefaultAgent = vi.fn();

    render(
      <ConfigurationSection
        defaultAgent="auto"
        setDefaultAgent={setDefaultAgent}
        routing="auto"
        setRouting={vi.fn()}
        approvalMode="ask"
        setApprovalMode={vi.fn()}
        defaultAgentOptions={[
          ['auto', 'Auto select'],
          ['codex', 'Codex'],
        ]}
        routingOptions={[['auto', 'settings.routingAuto']]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Auto select/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }));

    expect(setDefaultAgent).toHaveBeenCalledWith('codex');
    expect(localStorage.getItem('agenthub-settings.defaultAgent')).toBe('codex');
  });

  it('shows the selected routing label when the stored value matches an option', () => {
    render(
      <ConfigurationSection
        defaultAgent="auto"
        setDefaultAgent={vi.fn()}
        routing="auto"
        setRouting={vi.fn()}
        approvalMode="ask"
        setApprovalMode={vi.fn()}
        defaultAgentOptions={[['auto', 'Auto select']]}
        routingOptions={[['auto', 'settings.routingAuto']]}
      />,
    );

    expect(screen.getByRole('button', { name: 'settings.routingAuto' })).toBeInTheDocument();
  });
});
