import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HUB_EVENTS, type HubEventType } from './hubEvents';

describe('HUB_EVENTS', () => {
  it('exports the Hub-to-Edge agent control event type', () => {
    const eventType: HubEventType = HUB_EVENTS.AGENT_CONTROL;

    expect(eventType).toBe('agent.control');
  });

  it('matches every Go Hub frame constant exactly', () => {
    const frameSource = readFileSync(
      resolve(process.cwd(), '../../hub-server/internal/ws/frame.go'),
      'utf8',
    );
    const goFrameTypes = [...frameSource.matchAll(/^\s*Type\w+\s*=\s*"([^"]+)"/gm)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined)
      .sort();
    const sharedFrameTypes = [...Object.values(HUB_EVENTS)].sort();

    expect(sharedFrameTypes).toEqual(goFrameTypes);
  });

  it('does not expose Hub frame names without a wire producer', () => {
    expect(Object.values(HUB_EVENTS)).not.toEqual(
      expect.arrayContaining([
        'auth',
        'auth.fail',
        'sync.request',
        'sync.events',
        'agent.regenerate',
        'message.edited',
        'agent.timeout',
        'run.agent.plan_proposed',
        'run.agent.plan_approved',
        'run.agent.plan_rejected',
        'run.agent.plan_expired',
      ]),
    );
  });
});
