import { describe, it, expect } from 'vitest';

describe('GroupWorkspacePage', () => {
  it('can be imported and is a valid React component function', async () => {
    const mod = await import('@/pages/group-workspace/GroupWorkspacePage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
