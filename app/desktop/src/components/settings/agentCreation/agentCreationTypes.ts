// Agent creation wizard types
export interface AgentTemplate {
  id: string;
  name: string;
  emoji: string;
  category: string;
  description: string;
  systemPrompt: string;
  capabilities: Record<string, boolean>;
  modelPreference: {
    model: string;
    temperature: number;
    maxTokens: number;
    reasoningEffort: string;
  };
}

export interface WizardStep {
  id: number;
  titleKey: string;
  descriptionKey: string;
}

export interface AgentCreationState {
  step: number;
  // Step 1: Basic info
  name: string;
  emoji: string;
  description: string;
  // Step 2: System prompt
  systemPrompt: string;
  // Step 3: Model settings
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: string;
  // Step 4: Tool toggles
  capabilities: Record<string, boolean>;
  // Step 5: Knowledge base
  knowledgeBase: string;
  // Meta
  draftId: string;
}
