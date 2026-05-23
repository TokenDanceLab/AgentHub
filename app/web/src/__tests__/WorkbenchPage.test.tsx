import { describe, it, expect } from 'vitest';

describe('WorkbenchPage', () => {
  it('can be imported and is a valid React component function', async () => {
    const mod = await import('@/pages/workbench/WorkbenchPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
