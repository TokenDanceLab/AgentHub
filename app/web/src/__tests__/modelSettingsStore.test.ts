import { beforeEach, describe, expect, it } from 'vitest';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';

describe('modelSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useModelSettingsStore.getState().reset();
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
