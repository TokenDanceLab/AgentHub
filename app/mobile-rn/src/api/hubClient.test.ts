import { describe, expect, it } from 'vitest';

import { createHubWsUrl, createMockHubClient } from './hubClient';

describe('Mobile Hub client facade', () => {
  it('maps REST base URLs to Hub event WebSocket URLs', () => {
    expect(createHubWsUrl('http://127.0.0.1:8080')).toBe('ws://127.0.0.1:8080/v1/events');
    expect(createHubWsUrl('https://hub.example.test')).toBe('wss://hub.example.test/v1/events');
  });

  it('returns realistic mobile workflow snapshot data from the mock client', async () => {
    const snapshot = await createMockHubClient(0).getMobileSnapshot();

    expect(snapshot.threads.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.runs.some((run) => run.status === 'approval_required')).toBe(true);
    expect(snapshot.transcript['mobile-design']?.some((block) => block.kind === 'diff')).toBe(true);
  });
});
