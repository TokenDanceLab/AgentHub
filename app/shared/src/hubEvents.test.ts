import { describe, expect, it } from 'vitest';

import { HUB_EVENTS, type HubEventType } from './hubEvents';

describe('HUB_EVENTS', () => {
  it('exports the Hub-to-Edge agent control event type', () => {
    const eventType: HubEventType = HUB_EVENTS.AGENT_CONTROL;

    expect(eventType).toBe('agent.control');
  });
});
