import { describe, it, expect } from 'vitest';

describe('ProjectPage', () => {
  it('can be imported and is a valid React component function', async () => {
    const mod = await import('@/pages/projects/ProjectPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
