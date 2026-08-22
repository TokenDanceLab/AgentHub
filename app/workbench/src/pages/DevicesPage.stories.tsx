import type { Meta, StoryObj } from '@storybook/react';
import { DevicesPage, type DevicesPageTarget } from './DevicesPage';

const targets: DevicesPageTarget[] = [
  {
    id: 'target-local-edge-alpha',
    name: 'Alpha Desktop',
    targetType: 'local_edge',
    healthState: 'healthy',
    isOnline: true,
    trustLevel: 'local',
    endpoint: '127.0.0.1:8443',
    workspaceRoot: '/home/operator/projects/agenthub',
    lastSeenAt: '2026-08-23T08:30:00.000Z',
  },
  {
    id: 'target-hub-relay-1',
    name: 'Hub Relay',
    targetType: 'hub_relay',
    healthState: 'stale',
    isOnline: false,
    trustLevel: 'relay',
    lastSeenAt: '2026-08-21T10:00:00.000Z',
  },
  {
    id: 'target-remote-ssh-beta',
    name: 'Beta SSH Box',
    targetType: 'remote_ssh',
    healthState: 'mismatch',
    isOnline: false,
    trustLevel: 'remote',
    endpoint: 'beta.internal:22',
  },
];

const meta: Meta<typeof DevicesPage> = {
  title: 'Workbench/DevicesPage',
  component: DevicesPage,
  args: {
    targets,
    loading: false,
    onPingTarget: () => {},
    onRetry: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DevicesPage>;

export const Inventory: Story = {};

export const SignedOut: Story = {
  args: { targets: undefined },
};

export const Empty: Story = {
  args: { targets: [] },
};

export const LoadError: Story = {
  args: { targets: [], error: 'GET /web/execution-targets → 503' },
};

export const Pinging: Story = {
  args: { pingingTargetId: 'target-local-edge-alpha' },
};
