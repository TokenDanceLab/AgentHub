/**
 * Shared test helpers for adapter test splits (#adapter-split).
 * Extracted from adapter.test.ts to keep the three split files DRY.
 */

export const DEFAULT_AGENT_NAME = 'TestAgent';
export const DEFAULT_USER_NAME = 'User';

export const makeAuthor = (id: string, name = DEFAULT_AGENT_NAME) => ({
  id,
  name,
  role: 'agent' as const,
});

export const makeUser = (id: string, name = DEFAULT_USER_NAME) => ({
  id,
  name,
  role: 'human' as const,
});

export const makeTime = (offsetMin = 0) =>
  new Date(Date.UTC(2026, 5, 17, 14, 30 + offsetMin)).toISOString();
