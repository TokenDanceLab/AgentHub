import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HUB_EVENTS, type HubEventType } from './hubEvents';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('HUB_EVENTS', () => {
  it('exports the Hub-to-Edge agent control event type', () => {
    const eventType: HubEventType = HUB_EVENTS.AGENT_CONTROL;

    expect(eventType).toBe('agent.control');
  });

  it('matches every Go Hub frame constant exactly', () => {
    const frameSource = readFileSync(
      resolve(repoRoot, 'hub-server/internal/ws/frame.go'),
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

  it('documents duplicate-delivery semantics for every live Hub WS type in api/events.md', () => {
    const eventsDoc = readFileSync(resolve(repoRoot, 'api/events.md'), 'utf8');
    const tableStart = eventsDoc.indexOf('## Hub WS 事件：重复投递 / 幂等语义');
    expect(tableStart).toBeGreaterThanOrEqual(0);
    const removedStart = eventsDoc.indexOf('## Removed Hub WS Dead Surface', tableStart);
    const semanticsSection =
      removedStart >= 0
        ? eventsDoc.slice(tableStart, removedStart)
        : eventsDoc.slice(tableStart);

    // Dead surface must stay out of the live semantics table (and HUB_EVENTS).
    for (const dead of [
      'sync.request',
      'sync.events',
      'agent.regenerate',
      'message.edited',
      'agent.timeout',
      'auth.fail',
    ]) {
      expect(semanticsSection).not.toContain(`| \`${dead}\``);
    }

    const missing = Object.values(HUB_EVENTS).filter(
      (type) => !semanticsSection.includes(`| \`${type}\``),
    );
    expect(missing).toEqual([]);
  });
});
