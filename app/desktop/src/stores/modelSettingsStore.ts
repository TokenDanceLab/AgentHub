import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

export type ReasoningEffortPreference = 'low' | 'medium' | 'high' | 'max';
export type ProviderHealth = 'ready' | 'degraded' | 'disabled';

export interface ModelAliasMapping {
  alias: string;
  model: string;
  provider: string;
  reasoningEffort: ReasoningEffortPreference;
  enabled: boolean;
}

export interface CcSwitchProvider {
  id: string;
  name: string;
  health: ProviderHealth;
  modelCount: number;
  notes: string;
}

interface ModelSettingsState {
  defaultModel: string;
  defaultProvider: string;
  reasoningEffort: ReasoningEffortPreference;
  providerFallbackEnabled: boolean;
  modelMappingEnabled: boolean;
  aliases: ModelAliasMapping[];
  ccSwitchBridgeEnabled: boolean;
  ccSwitchProviders: CcSwitchProvider[];
  setDefaultModel: (value: string) => void;
  setDefaultProvider: (value: string) => void;
  setReasoningEffort: (value: ReasoningEffortPreference) => void;
  setProviderFallbackEnabled: (value: boolean) => void;
  setModelMappingEnabled: (value: boolean) => void;
  updateAlias: (alias: string, updates: Partial<Omit<ModelAliasMapping, 'alias'>>) => void;
  toggleAlias: (alias: string) => void;
  setCcSwitchBridgeEnabled: (value: boolean) => void;
  updateProvider: (id: string, updates: Partial<Omit<CcSwitchProvider, 'id'>>) => void;
  resolveRunRequestOptions: (input?: RunModelSettingsInput) => ResolvedRunModelSettings;
  reset: () => void;
}

export interface RunModelSettingsInput {
  model?: string;
  reasoningEffort?: string;
}

export interface ResolvedRunModelSettings {
  model?: string;
  provider?: string;
  reasoningEffort?: string;
  modelAlias?: string;
  modelMappingEnabled: boolean;
  providerFallbackEnabled: boolean;
}

const DEFAULT_REASONING_EFFORT: ReasoningEffortPreference = 'high';

const DEFAULT_ALIASES: ModelAliasMapping[] = [
  {
    alias: 'opus',
    model: 'claude-opus-4-7',
    provider: 'anthropic',
    reasoningEffort: 'max',
    enabled: true,
  },
  {
    alias: 'sonnet',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    reasoningEffort: 'high',
    enabled: true,
  },
  {
    alias: 'haiku',
    model: 'glm-5.1',
    provider: 'tokendance-relay',
    reasoningEffort: 'medium',
    enabled: true,
  },
];

const DEFAULT_CC_SWITCH_PROVIDERS: CcSwitchProvider[] = [
  {
    id: 'tokendance-relay',
    name: 'TokenDance Relay',
    health: 'ready',
    modelCount: 8,
    notes: 'Primary ecosystem relay for shared routing.',
  },
  {
    id: 'cc-switch-local',
    name: 'cc-switch local',
    health: 'degraded',
    modelCount: 3,
    notes: 'Local provider bridge; health should be refreshed by cc-switch integration.',
  },
  {
    id: 'manual-provider',
    name: 'Manual provider',
    health: 'disabled',
    modelCount: 0,
    notes: 'Reserved for manually configured provider credentials.',
  },
];

const cloneAliases = () => DEFAULT_ALIASES.map((item) => ({ ...item }));
const cloneCcSwitchProviders = () => DEFAULT_CC_SWITCH_PROVIDERS.map((item) => ({ ...item }));

function resolveRunRequestOptions(state: ModelSettingsState, input: RunModelSettingsInput = {}): ResolvedRunModelSettings {
  const requestedModel = input.model?.trim() ?? '';
  const defaultModel = state.defaultModel.trim();
  const candidateModel = requestedModel || (defaultModel && defaultModel !== 'auto' ? defaultModel : '');
  const alias = state.modelMappingEnabled && candidateModel
    ? state.aliases.find((item) => item.enabled && item.alias === candidateModel)
    : undefined;
  const model = alias?.model ?? candidateModel;
  const provider = alias?.provider ?? (state.defaultProvider.trim() || undefined);
  const reasoningEffort = input.reasoningEffort?.trim() || alias?.reasoningEffort || state.reasoningEffort;

  return {
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(alias ? { modelAlias: alias.alias } : {}),
    modelMappingEnabled: state.modelMappingEnabled,
    providerFallbackEnabled: state.providerFallbackEnabled,
  };
}

export const useModelSettingsStore = create<ModelSettingsState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        defaultModel: 'auto',
        defaultProvider: 'tokendance-relay',
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        providerFallbackEnabled: true,
        modelMappingEnabled: true,
        aliases: cloneAliases(),
        ccSwitchBridgeEnabled: false,
        ccSwitchProviders: cloneCcSwitchProviders(),

        setDefaultModel: (value) => set({ defaultModel: value }),
        setDefaultProvider: (value) => set({ defaultProvider: value }),
        setReasoningEffort: (value) => set({ reasoningEffort: value }),
        setProviderFallbackEnabled: (value) => set({ providerFallbackEnabled: value }),
        setModelMappingEnabled: (value) => set({ modelMappingEnabled: value }),
        updateAlias: (alias, updates) =>
          set((state) => ({
            aliases: state.aliases.map((item) =>
              item.alias === alias ? { ...item, ...updates } : item,
            ),
          })),
        toggleAlias: (alias) =>
          set((state) => ({
            aliases: state.aliases.map((item) =>
              item.alias === alias ? { ...item, enabled: !item.enabled } : item,
            ),
          })),
        setCcSwitchBridgeEnabled: (value) => set({ ccSwitchBridgeEnabled: value }),
        updateProvider: (id, updates) =>
          set((state) => ({
            ccSwitchProviders: state.ccSwitchProviders.map((item) =>
              item.id === id ? { ...item, ...updates } : item,
            ),
          })),
        resolveRunRequestOptions: (input): ResolvedRunModelSettings => resolveRunRequestOptions(get(), input),
        reset: () =>
          set({
            defaultModel: 'auto',
            defaultProvider: 'tokendance-relay',
            reasoningEffort: DEFAULT_REASONING_EFFORT,
            providerFallbackEnabled: true,
            modelMappingEnabled: true,
            aliases: cloneAliases(),
            ccSwitchBridgeEnabled: false,
            ccSwitchProviders: cloneCcSwitchProviders(),
          }),
      }),
      {
        name: 'agenthub-model-settings',
        version: 1,
      },
    ),
  ),
);

export const DEFAULT_MODEL_ALIASES = DEFAULT_ALIASES;
export const DEFAULT_CC_SWITCH_PROVIDER_STATUS = DEFAULT_CC_SWITCH_PROVIDERS;
