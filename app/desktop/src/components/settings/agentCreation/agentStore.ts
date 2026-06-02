import type { AgentCreationState, AgentTemplate } from './agentCreationTypes';

const STORAGE_KEY = 'agenthub-custom-agents';
const DRAFT_KEY = 'agenthub-agent-draft';

export interface StoredCustomAgent {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: string;
  capabilities: Record<string, boolean>;
  knowledgeBase: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

function generateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadCustomAgents(): StoredCustomAgent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is StoredCustomAgent =>
          typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).id === 'string',
      );
    }
  } catch {
    /* localStorage unavailable or corrupt */
  }
  return [];
}

export function saveCustomAgent(agent: StoredCustomAgent): void {
  const agents = loadCustomAgents();
  const idx = agents.findIndex((a) => a.id === agent.id);
  if (idx >= 0) {
    agents[idx] = agent;
  } else {
    agents.push(agent);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  } catch {
    /* storage full or unavailable */
  }
}

export function deleteCustomAgent(id: string): void {
  const agents = loadCustomAgents().filter((a) => a.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  } catch {
    /* storage full or unavailable */
  }
}

export function persistFromWizard(state: AgentCreationState): StoredCustomAgent {
  const now = new Date().toISOString();
  const id = state.draftId || generateId();
  const agent: StoredCustomAgent = {
    id,
    name: state.name,
    emoji: state.emoji,
    description: state.description,
    systemPrompt: state.systemPrompt,
    model: state.model,
    temperature: state.temperature,
    maxTokens: state.maxTokens,
    reasoningEffort: state.reasoningEffort,
    capabilities: { ...state.capabilities },
    knowledgeBase: state.knowledgeBase,
    source: '/web/custom-agents',
    createdAt: now,
    updatedAt: now,
  };
  saveCustomAgent(agent);
  return agent;
}

export function createFromTemplate(template: AgentTemplate): AgentCreationState {
  return {
    step: 1,
    name: template.name,
    emoji: template.emoji,
    description: template.description,
    systemPrompt: template.systemPrompt,
    model: template.modelPreference.model,
    temperature: template.modelPreference.temperature,
    maxTokens: template.modelPreference.maxTokens,
    reasoningEffort: template.modelPreference.reasoningEffort,
    capabilities: { ...template.capabilities },
    knowledgeBase: '',
    draftId: generateId(),
  };
}

export function loadDraft(): AgentCreationState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AgentCreationState;
  } catch {
    return null;
  }
}

export function saveDraft(state: AgentCreationState): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    /* storage full */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* unavailable */
  }
}
