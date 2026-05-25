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
      provider: 'tokendance-relay',
      reasoningEffort: 'low',
      modelMappingEnabled: false,
    });
  });

  it('omits auto default model while preserving routing metadata', () => {
    expect(useModelSettingsStore.getState().resolveRunRequestOptions()).toMatchObject({
      provider: 'tokendance-relay',
      reasoningEffort: 'high',
      modelMappingEnabled: true,
      providerFallbackEnabled: true,
    });
    expect(useModelSettingsStore.getState().resolveRunRequestOptions().model).toBeUndefined();
  });
});
