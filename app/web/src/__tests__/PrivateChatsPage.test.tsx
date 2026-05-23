import { describe, it, expect } from 'vitest';

describe('PrivateChatsPage', () => {
  it('can be imported and is a valid React component function', async () => {
    const mod = await import('@/pages/private-chats/PrivateChatsPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
