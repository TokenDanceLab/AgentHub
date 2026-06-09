import type { AgentInfo } from '@shared/types';
import type {
  LocalCliDiscoveryItem,
  LocalCliDiscoveryManifest,
  LocalCliRuntimeId,
} from '@shared/platform';

export type { LocalCliDiscoveryItem, LocalCliDiscoveryManifest, LocalCliRuntimeId };

export const LOCAL_CLI_READINESS_MANIFEST = 'docs/audit/p0-edge-cli-real-readiness.md';
export const LOCAL_CLI_READINESS_SCRIPT = 'scripts/verify-edge-cli-real-readiness.ps1';

const runtimeDefaults: Record<LocalCliRuntimeId, Omit<LocalCliDiscoveryItem, 'installed' | 'version'>> = {
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    path: 'codex',
    noSpend: true,
  },
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    path: 'claude',
    noSpend: true,
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    path: 'opencode',
    noSpend: true,
  },
};

export const localCliDiscoveryFixture: LocalCliDiscoveryManifest = {
  mode: 'no-spend-discovery',
  readinessManifest: LOCAL_CLI_READINESS_MANIFEST,
  readinessScript: LOCAL_CLI_READINESS_SCRIPT,
  generatedAt: '2026-06-09T00:00:00.000Z',
  items: [
    {
      ...runtimeDefaults.codex,
      installed: true,
      version: '0.27.0',
      path: 'C:/Users/Ding/AppData/Roaming/npm/codex.cmd',
    },
    {
      ...runtimeDefaults['claude-code'],
      installed: true,
      version: '2.1.4',
      path: 'C:/Users/Ding/AppData/Roaming/npm/claude.cmd',
    },
    {
      ...runtimeDefaults.opencode,
      installed: true,
      version: '0.8.3',
      path: 'C:/Users/Ding/AppData/Roaming/npm/opencode.cmd',
    },
  ],
};

export const emptyLocalCliDiscoveryManifest: LocalCliDiscoveryManifest = {
  mode: 'no-spend-discovery',
  readinessManifest: LOCAL_CLI_READINESS_MANIFEST,
  readinessScript: LOCAL_CLI_READINESS_SCRIPT,
  generatedAt: null,
  items: (Object.keys(runtimeDefaults) as LocalCliRuntimeId[]).map((id) => ({
    ...runtimeDefaults[id],
    installed: false,
    version: null,
  })),
};

export function buildLocalCliDiscoveryFromAgents(
  agents: AgentInfo[],
  hostDiscovery?: LocalCliDiscoveryManifest | null,
): LocalCliDiscoveryManifest {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const hostById = new Map((hostDiscovery?.items ?? []).map((item) => [item.id, item]));

  return {
    mode: 'no-spend-discovery',
    readinessManifest: hostDiscovery?.readinessManifest || LOCAL_CLI_READINESS_MANIFEST,
    readinessScript: hostDiscovery?.readinessScript || LOCAL_CLI_READINESS_SCRIPT,
    generatedAt: hostDiscovery?.generatedAt ?? null,
    items: (Object.keys(runtimeDefaults) as LocalCliRuntimeId[]).map((id) => {
      const base = runtimeDefaults[id];
      const agent = byId.get(id);
      const host = hostById.get(id);
      return {
        ...base,
        installed: host?.installed ?? agent?.status === 'available',
        version: host?.version ?? agent?.version ?? null,
        path: host?.path || base.path,
        noSpend: true,
      };
    }),
  };
}
