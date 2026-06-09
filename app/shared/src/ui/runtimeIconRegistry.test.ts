import { describe, expect, it } from 'vitest';
import {
  normalizeRuntimeIconKey,
  resolveRuntimeIconRegistry,
  runtimeIconRegistry,
} from './runtimeIconRegistry';

describe('runtimeIconRegistry', () => {
  it('keeps runtime, provider, model, and tool mappings in one registry', () => {
    expect(runtimeIconRegistry.runtimes['claude-code']).toMatchObject({ lobeType: 'runtime' });
    expect(runtimeIconRegistry.providers.openai).toMatchObject({ lobeType: 'provider' });
    expect(runtimeIconRegistry.toolFallbacks.write).toEqual(['write', 'edit', 'patch']);
  });

  it('normalizes aliases before resolving LobeHub icons', () => {
    expect(normalizeRuntimeIconKey('Open Code')).toBe('open-code');
    expect(resolveRuntimeIconRegistry({ kind: 'runtime', name: 'OpenAI Codex' })).toMatchObject({
      source: 'lobehub',
      value: 'codex',
      lobeType: 'runtime',
    });
    expect(
      resolveRuntimeIconRegistry({ kind: 'provider', name: 'ByteDance Doubao' })
    ).toMatchObject({
      source: 'lobehub',
      value: 'bytedance',
      lobeType: 'provider',
    });
  });

  it('keeps internal and custom runtime fallbacks deterministic', () => {
    expect(
      resolveRuntimeIconRegistry({ kind: 'provider', name: 'TokenDance Gateway' })
    ).toMatchObject({
      source: 'fallback',
      fallback: 'agenthub',
      value: 'TG',
    });
    expect(resolveRuntimeIconRegistry({ kind: 'runtime', name: 'Custom Agent' })).toMatchObject({
      source: 'fallback',
      fallback: 'custom',
      value: 'CA',
    });
    expect(resolveRuntimeIconRegistry({ kind: 'tool', name: 'apply_patch' })).toMatchObject({
      source: 'fallback',
      fallback: 'write',
      value: 'A',
    });
    expect(resolveRuntimeIconRegistry({ kind: 'tool', name: 'Execution Target' })).toMatchObject({
      source: 'fallback',
      fallback: 'target',
      value: 'E',
    });
  });
});
