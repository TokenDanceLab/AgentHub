import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@shared/types';
import {
  buildLocalCliDiscoveryFromAgents,
  emptyLocalCliDiscoveryManifest,
  type LocalCliDiscoveryManifest,
} from './cliDiscovery';

describe('buildLocalCliDiscoveryFromAgents', () => {
  it('defaults to a no-spend missing manifest when Desktop has no host or agent evidence', () => {
    const discovery = buildLocalCliDiscoveryFromAgents([]);

    expect(discovery.mode).toBe('no-spend-discovery');
    expect(discovery.items).toHaveLength(3);
    expect(discovery.items.every((item) => item.noSpend)).toBe(true);
    expect(discovery.items.every((item) => !item.installed && item.version === null)).toBe(true);
  });

  it('uses host discovery before Edge agent inventory', () => {
    const agents = [
      {
        id: 'codex',
        name: 'Codex CLI',
        status: 'available',
        version: 'edge-0.1.0',
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        status: 'available',
        version: 'edge-2.0.0',
      },
    ] as AgentInfo[];
    const hostDiscovery: LocalCliDiscoveryManifest = {
      ...emptyLocalCliDiscoveryManifest,
      items: [
        {
          id: 'codex',
          name: 'Codex CLI',
          installed: true,
          version: 'host-0.2.0',
          path: 'C:/Tools/codex.cmd',
          noSpend: true,
        },
      ],
    };

    const discovery = buildLocalCliDiscoveryFromAgents(agents, hostDiscovery);

    expect(discovery.items.find((item) => item.id === 'codex')).toMatchObject({
      installed: true,
      version: 'host-0.2.0',
      path: 'C:/Tools/codex.cmd',
    });
    expect(discovery.items.find((item) => item.id === 'claude-code')).toMatchObject({
      installed: true,
      version: 'edge-2.0.0',
      path: 'claude',
    });
    expect(discovery.items.find((item) => item.id === 'opencode')).toMatchObject({
      installed: false,
      version: null,
      path: 'opencode',
    });
  });
});
