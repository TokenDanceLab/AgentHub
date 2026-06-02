import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { AgentInfo } from '@shared/types';
import MentionPopover from './MentionPopover';

const capabilities = {
  streaming: true,
  toolCalls: true,
  fileChanges: true,
  thinkingVisible: true,
  multiTurn: true,
  mcpIntegration: true,
  permissionHooks: true,
  subAgentSpawn: false,
};

const agents: AgentInfo[] = [
  {
    id: 'profile_codex',
    name: 'Codex',
    description: 'Desktop aligned coding profile',
    status: 'available',
    capabilities,
  },
];

describe('MentionPopover', () => {
  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await i18n.changeLanguage('zh');
  });

  it('localizes the suggestion list label and selects an agent', () => {
    const onSelect = vi.fn();

    render(
      <MentionPopover
        agents={agents}
        isOpen
        query="co"
        position={{ top: 10, left: 12 }}
        selectedIndex={0}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('listbox', { name: 'Agent 建议' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    expect(onSelect).toHaveBeenCalledWith(agents[0]);
  });
});
