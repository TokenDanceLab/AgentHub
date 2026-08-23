import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ElementType } from 'react';
import { describe, expect, it } from 'vitest';
import type { Meta, StoryObj } from '@storybook/react';
import devicesMeta, * as devicesStories from './DevicesPage.stories';
import usageMeta, * as usageStories from './TokenUsagePage.stories';

/* ═══════════════════════════════════════════════════════════════════════
   Pages stories smoke (#1856 coverage gate) — story files are coverage-
   included production modules. Mounting every exported story catches
   story fixtures that reference removed props or render broken states,
   so the Storybook巡检 fixtures stay executable, not decorative.
   ═══════════════════════════════════════════════════════════════════════ */

function storyCases(stories: Record<string, unknown>): Array<[string, StoryObj]> {
  return Object.entries(stories).filter(
    (entry): entry is [string, StoryObj] => entry[0] !== 'default' && typeof entry[1] === 'object',
  );
}

function mountStory(meta: Meta, story: StoryObj): void {
  const Component = meta.component;
  expect(Component).toBeDefined();
  const args = { ...(meta.args ?? {}), ...(story.args ?? {}) };
  render(createElement(Component as ElementType, args));
}

describe('DevicesPage stories smoke', () => {
  for (const [name, story] of storyCases(devicesStories)) {
    it(`mounts ${name}`, () => {
      mountStory(devicesMeta, story);
      expect(screen.getByTestId('devices-page')).toBeInTheDocument();
    });
  }
});

describe('TokenUsagePage stories smoke', () => {
  for (const [name, story] of storyCases(usageStories)) {
    it(`mounts ${name}`, () => {
      mountStory(usageMeta, story);
      expect(screen.getByTestId('usage-page')).toBeInTheDocument();
    });
  }
});
