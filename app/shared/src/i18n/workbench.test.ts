import { describe, expect, it } from 'vitest';
import {
  SHARED_WORKBENCH_I18N_NAMESPACE,
  flattenSharedWorkbenchResource,
  sharedWorkbenchResources,
} from './workbench';

describe('shared workbench i18n resources', () => {
  it('uses a stable namespace for Desktop/Web shared UI', () => {
    expect(SHARED_WORKBENCH_I18N_NAMESPACE).toBe('sharedWorkbench');
  });

  it('keeps zh/en workbench key sets in parity', () => {
    const zhKeys = flattenSharedWorkbenchResource(sharedWorkbenchResources.zh).sort();
    const enKeys = flattenSharedWorkbenchResource(sharedWorkbenchResources.en).sort();

    expect(zhKeys).toEqual(enKeys);
    expect(zhKeys).toContain('inspector.overview');
    expect(zhKeys).toContain('transcript.running');
    expect(zhKeys).toContain('composer.placeholder');
  });
});
