import { describe, expect, it } from 'vitest';

import { agentHubThemes, getAgentHubTheme } from './tokens';

describe('AgentHub mobile tokens', () => {
  it('keeps mobile touch targets at or above the design contract', () => {
    expect(agentHubThemes.light.touch.minimum).toBeGreaterThanOrEqual(44);
    expect(agentHubThemes.dark.touch.minimum).toBeGreaterThanOrEqual(44);
    expect(agentHubThemes.oled.touch.primary).toBeGreaterThanOrEqual(48);
  });

  it('uses AgentHub desktop-aligned dark glass values', () => {
    expect(agentHubThemes.dark.color.canvas).toBe('#1f1f27');
    expect(agentHubThemes.dark.color.ink).toBe('#e3e4e6');
    expect(agentHubThemes.dark.color.accent).toBe('#5d68cc');
  });

  it('resolves system mode from the current scheme', () => {
    expect(getAgentHubTheme('system', true).scheme).toBe('dark');
    expect(getAgentHubTheme('system', false).scheme).toBe('light');
  });
});
