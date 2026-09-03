import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

type ReasoningEffortPreference = 'low' | 'medium' | 'high' | 'max';
type ProviderHealth = 'ready' | 'degraded' | 'disabled';
type CredentialTestResult = 'idle' | 'connecting' | 'success' | 'error';

interface ModelAliasMapping {
  alias: string;
  model: string;
  provider: string;
  reasoningEffort: ReasoningEffortPreference;
  enabled: boolean;
}

interface CcSwitchProvider {
  id: string;
  name: string;
  health: ProviderHealth;
  modelCount: number;
  notes: string;
}

interface ProviderCredential {
  providerId: string;
  apiKey: string;
  enabled: boolean;
  baseUrl: string;
  testResult: CredentialTestResult;
  testError: string;
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
  credentials: ProviderCredential[];
  setDefaultModel: (value: string) => void;
  setDefaultProvider: (value: string) => void;
  setReasoningEffort: (value: ReasoningEffortPreference) => void;
  setProviderFallbackEnabled: (value: boolean) => void;
  setModelMappingEnabled: (value: boolean) => void;
  updateAlias: (alias: string, updates: Partial<Omit<ModelAliasMapping, 'alias'>>) => void;
  toggleAlias: (alias: string) => void;
  setCcSwitchBridgeEnabled: (value: boolean) => void;
  updateProvider: (id: string, updates: Partial<Omit<CcSwitchProvider, 'id'>>) => void;
  setCredential: (providerId: string, updates: Partial<Omit<ProviderCredential, 'providerId'>>) => void;
  setCredentialTestResult: (providerId: string, result: CredentialTestResult, error?: string) => void;
  resolveRunRequestOptions: (input?: RunModelSettingsInput) => ResolvedRunModelSettings;
  reset: () => void;
}

interface RunModelSettingsInput {
  model?: string;
  provider?: string;
  modelAlias?: string;
  reasoningEffort?: string;
}

interface ResolvedRunModelSettings {
  model?: string;
  provider?: string;
  reasoningEffort?: string;
  modelAlias?: string;
  modelMappingEnabled: boolean;
  providerFallbackEnabled: boolean;
}

const DEFAULT_REASONING_EFFORT: ReasoningEffortPreference = 'high';
const TOKENDANCE_GATEWAY_PROVIDER_ID = 'tokendance-gateway';
const LEGACY_TOKENDANCE_RELAY_PROVIDER_ID = 'tokendance-relay';

const DEFAULT_ALIASES: ModelAliasMapping[] = [
  {
    alias: 'opus',
    model: 'deepseek-v4-pro',
    provider: TOKENDANCE_GATEWAY_PROVIDER_ID,
    reasoningEffort: 'max',
    enabled: true,
  },
  {
    alias: 'sonnet',
    model: 'deepseek-v4-flash',
    provider: TOKENDANCE_GATEWAY_PROVIDER_ID,
    reasoningEffort: 'high',
    enabled: true,
  },
  {
    alias: 'haiku',
    model: 'glm-5.1',
    provider: TOKENDANCE_GATEWAY_PROVIDER_ID,
    reasoningEffort: 'medium',
    enabled: true,
  },
];

const DEFAULT_CC_SWITCH_PROVIDERS: CcSwitchProvider[] = [
  {
    id: TOKENDANCE_GATEWAY_PROVIDER_ID,
    name: 'TokenDance Gateway',
    health: 'ready',
    modelCount: 8,
    notes: 'Primary ecosystem gateway for shared model routing.',
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

const DEFAULT_CREDENTIALS: ProviderCredential[] = [
  {
    providerId: 'tokendance-gateway',
    apiKey: '',
    enabled: true,
    baseUrl: '',
    testResult: 'idle',
    testError: '',
  },
  {
    providerId: 'anthropic',
    apiKey: '',
    enabled: false,
    baseUrl: '',
    testResult: 'idle',
    testError: '',
  },
  {
    providerId: 'openai',
    apiKey: '',
    enabled: false,
    baseUrl: '',
    testResult: 'idle',
    testError: '',
  },
  {
    providerId: 'cc-switch-local',
    apiKey: '',
    enabled: false,
    baseUrl: '',
    testResult: 'idle',
    testError: '',
  },
];

const cloneAliases = () => DEFAULT_ALIASES.map((item) => ({ ...item }));
const cloneCcSwitchProviders = () => DEFAULT_CC_SWITCH_PROVIDERS.map((item) => ({ ...item }));
const cloneCredentials = () => DEFAULT_CREDENTIALS.map((item) => ({ ...item }));




function migrateProviderId(provider: string | undefined): string | undefined {
  return provider === LEGACY_TOKENDANCE_RELAY_PROVIDER_ID ? TOKENDANCE_GATEWAY_PROVIDER_ID : provider;
}

function migratePersistedState(persistedState: unknown): unknown {
  if (!persistedState || typeof persistedState !== 'object') return persistedState;
  const state = persistedState as Partial<ModelSettingsState>;

  return {
    ...state,
    defaultProvider: migrateProviderId(state.defaultProvider),
    aliases: state.aliases?.map((item) => {
      const provider = migrateProviderId(item.provider) ?? item.provider;
      if (item.alias === 'opus' && item.model === 'claude-opus-4-7') {
        return { ...item, model: 'deepseek-v4-pro', provider: TOKENDANCE_GATEWAY_PROVIDER_ID };
      }
      if (item.alias === 'sonnet' && item.model === 'claude-sonnet-4-6') {
        return { ...item, model: 'deepseek-v4-flash', provider: TOKENDANCE_GATEWAY_PROVIDER_ID };
      }
      return { ...item, provider };
    }),
    ccSwitchProviders: state.ccSwitchProviders?.map((item) => ({
      ...item,
      id: migrateProviderId(item.id) ?? item.id,
      name: item.id === LEGACY_TOKENDANCE_RELAY_PROVIDER_ID || (item.name.startsWith('TokenDance') && item.name.includes('Relay'))
        ? 'TokenDance Gateway'
        : item.name,
      notes: item.id === LEGACY_TOKENDANCE_RELAY_PROVIDER_ID
        ? 'Primary ecosystem gateway for shared model routing.'
        : item.notes,
    })),
  };
}

function resolveRunRequestOptions(state: ModelSettingsState, input: RunModelSettingsInput = {}): ResolvedRunModelSettings {
  const requestedModel = input.model?.trim() ?? '';
  const defaultModel = state.defaultModel.trim();
  const candidateModel = requestedModel || (defaultModel && defaultModel !== 'auto' ? defaultModel : '');
  const alias = state.modelMappingEnabled && candidateModel
    ? state.aliases.find((item) => item.enabled && item.alias === candidateModel)
    : undefined;
  const model = alias?.model ?? candidateModel;
  const provider = input.provider?.trim() || alias?.provider || (state.defaultProvider.trim() || undefined);
  const reasoningEffort = input.reasoningEffort?.trim() || alias?.reasoningEffort || state.reasoningEffort;
  const modelAlias = input.modelAlias?.trim() || alias?.alias;

  return {
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(modelAlias ? { modelAlias } : {}),
    modelMappingEnabled: state.modelMappingEnabled,
    providerFallbackEnabled: state.providerFallbackEnabled,
  };
}

export const useModelSettingsStore = create<ModelSettingsState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        defaultModel: 'auto',
        defaultProvider: TOKENDANCE_GATEWAY_PROVIDER_ID,
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        providerFallbackEnabled: true,
        modelMappingEnabled: true,
        aliases: cloneAliases(),
        ccSwitchBridgeEnabled: false,
        ccSwitchProviders: cloneCcSwitchProviders(),
        credentials: cloneCredentials(),

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
        setCredential: (providerId, updates) =>
          set((state) => ({
            credentials: state.credentials.map((item) =>
              item.providerId === providerId ? { ...item, ...updates } : item,
            ),
          })),
        setCredentialTestResult: (providerId, result, error = '') =>
          set((state) => ({
            credentials: state.credentials.map((item) =>
              item.providerId === providerId ? { ...item, testResult: result, testError: error } : item,
            ),
          })),
        resolveRunRequestOptions: (input): ResolvedRunModelSettings => resolveRunRequestOptions(get(), input),
        reset: () =>
          set({
            defaultModel: 'auto',
            defaultProvider: TOKENDANCE_GATEWAY_PROVIDER_ID,
            reasoningEffort: DEFAULT_REASONING_EFFORT,
            providerFallbackEnabled: true,
            modelMappingEnabled: true,
            aliases: cloneAliases(),
            ccSwitchBridgeEnabled: false,
            ccSwitchProviders: cloneCcSwitchProviders(),
            credentials: cloneCredentials(),
          }),
      }),
      {
        name: 'agenthub-model-settings',
        version: 3,
        migrate: migratePersistedState,
      },
    ),
  ),
);
