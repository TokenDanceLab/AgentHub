import { beforeEach, describe, expect, it } from 'vitest';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';

describe('modelSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useModelSettingsStore.getState().reset();
  });

  it('resolves concrete default model settings for a run request', () => {
    useModelSettingsStore.getState().setDefaultModel('gpt-5.5');
    useModelSettingsStore.getState().setDefaultProvider('openai');
    useModelSettingsStore.getState().setReasoningEffort('max');

    expect(useModelSettingsStore.getState().resolveRunRequestOptions()).toMatchObject({
      model: 'gpt-5.5',
      provider: 'openai',
      reasoningEffort: 'max',
      modelMappingEnabled: true,
      providerFallbackEnabled: true,
    });
  });

  it('resolves enabled aliases to concrete model provider pairs', () => {
    expect(useModelSettingsStore.getState().resolveRunRequestOptions({ model: 'opus' })).toMatchObject({
      model: 'claude-opus-4-7',
      provider: 'anthropic',
      reasoningEffort: 'max',
      modelAlias: 'opus',
    });
  });

  it('passes through aliases when model mapping is disabled', () => {
    useModelSettingsStore.getState().setModelMappingEnabled(false);

    expect(useModelSettingsStore.getState().resolveRunRequestOptions({ model: 'opus', reasoningEffort: 'low' })).toMatchObject({
      model: 'opus',
      provider: 'tokendance-gateway',
      reasoningEffort: 'low',
      modelMappingEnabled: false,
    });
  });

  it('omits auto default model while preserving routing metadata', () => {
    expect(useModelSettingsStore.getState().resolveRunRequestOptions()).toMatchObject({
      provider: 'tokendance-gateway',
      reasoningEffort: 'high',
      modelMappingEnabled: true,
      providerFallbackEnabled: true,
    });
    expect(useModelSettingsStore.getState().resolveRunRequestOptions().model).toBeUndefined();
  });

  it('migrates persisted TokenDance Relay provider settings to TokenDance Gateway', async () => {
    localStorage.setItem('agenthub-model-settings', JSON.stringify({
      state: {
        defaultProvider: 'tokendance-relay',
        aliases: [
          {
            alias: 'haiku',
            model: 'glm-5.1',
            provider: 'tokendance-relay',
            reasoningEffort: 'medium',
            enabled: true,
          },
        ],
        ccSwitchProviders: [
          {
            id: 'tokendance-relay',
            name: 'TokenDance Relay',
            health: 'ready',
            modelCount: 8,
            notes: 'Primary ecosystem relay for shared routing.',
          },
        ],
      },
      version: 1,
    }));

    await useModelSettingsStore.persist.rehydrate();

    expect(useModelSettingsStore.getState().defaultProvider).toBe('tokendance-gateway');
    expect(useModelSettingsStore.getState().aliases[0]?.provider).toBe('tokendance-gateway');
    expect(useModelSettingsStore.getState().ccSwitchProviders[0]).toMatchObject({
      id: 'tokendance-gateway',
      name: 'TokenDance Gateway',
      notes: 'Primary ecosystem gateway for shared model routing.',
    });
  });
});
