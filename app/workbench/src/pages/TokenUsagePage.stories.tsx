import type { Meta, StoryObj } from '@storybook/react';
import { TokenUsagePage, type TokenUsagePageTeam } from './TokenUsagePage';

const teams: TokenUsagePageTeam[] = [
  {
    id: 'team-release',
    name: 'Release Crew',
    runs: [
      {
        id: 'run-1',
        status: 'completed',
        createdAt: '2026-08-22T09:00:00.000Z',
        tokenUsageTotal: 128_400,
        triggerMessage: 'ship the release',
      },
      {
        id: 'run-2',
        status: 'running',
        createdAt: '2026-08-23T02:10:00.000Z',
        tokenUsageTotal: 45_020,
        triggerMessage: 'hotfix login redirect',
      },
      // Pre-0066 run — no counter recorded, renders as em dash.
      { id: 'run-3', status: 'failed', createdAt: '2026-08-01T09:00:00.000Z' },
    ],
  },
  {
    id: 'team-docs',
    name: 'Docs Team',
    runs: [
      {
        id: 'run-9',
        status: 'completed',
        createdAt: '2026-08-20T12:00:00.000Z',
        tokenUsageTotal: 1_240_000,
        triggerMessage: 'rewrite onboarding docs',
      },
    ],
  },
];

const meta: Meta<typeof TokenUsagePage> = {
  title: 'Workbench/TokenUsagePage',
  component: TokenUsagePage,
  args: {
    teams,
    loading: false,
    onRetry: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof TokenUsagePage>;

export const WithRuns: Story = {};

export const SignedOut: Story = {
  args: { teams: undefined },
};

export const Empty: Story = {
  args: { teams: [] },
};

export const LoadError: Story = {
  args: { teams: [], error: 'GET /web/agent-teams → 500' },
};
