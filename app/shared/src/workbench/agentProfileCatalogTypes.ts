import type { AgentState } from './pages/AgentsPage';

/* ═══════════════════════════════════════════════════════════════════════
   agentProfileCatalogTypes — residual type extract from agentProfileCatalog
   (#652). Pure types only; no fixture data or mappers.
   ═══════════════════════════════════════════════════════════════════════ */

export type AgentProfileVisibility = 'private' | 'team' | 'marketplace' | 'fixture';
export type AgentRuntimeId = 'codex' | 'claude-code' | 'opencode' | 'browser-worker';
export type AgentApprovalMode = 'read-only' | 'workspace-write' | 'approval-required' | 'blocked';
export type AgentMemorySource = 'agents-md' | 'project-memory' | 'thread-context' | 'artifact-summary' | 'fixture';
export type AgentTargetPreference = 'local-edge' | 'remote-edge' | 'cloud-edge' | 'hub-relay' | 'fixture';

export interface AgentProfileCatalogItem {
  id: string;
  name: string;
  role: string;
  description: string;
  visibility: AgentProfileVisibility;
  source: 'fixture' | 'hub-agent-profile' | 'marketplace-draft';
  category: string;
  avatarRef: string;
  avatarColor: string;
  runtime: {
    runtimeId: AgentRuntimeId;
    label: string;
    provider: string;
    model: string;
    reasoning: string;
    adapterMode: 'cli' | 'sdk' | 'daemon' | 'fixture';
  };
  configuration: {
    mode: string;
    scope: string;
    state: AgentState;
    skills: string[];
    mcpServers: string[];
    toolAllowlist: string[];
    approval: {
      mode: AgentApprovalMode;
      summary: string;
      riskRules: Array<{ match: string; decision: 'allow' | 'require-approval' | 'deny' }>;
    };
    memory: {
      sources: AgentMemorySource[];
      retention: 'thread-only' | 'project-policy' | 'no-persist-fixture';
      summary: string;
    };
    targetPreferences: AgentTargetPreference[];
  };
  market: {
    featured: boolean;
    detail: string;
    installLabel: string;
  };
}
