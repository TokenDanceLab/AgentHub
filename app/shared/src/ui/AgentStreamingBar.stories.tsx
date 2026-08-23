import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AgentStreamingBar } from './AgentStreamingBar';
import { getAgentActivityStore, type AgentActivityStatus } from '../transcript/agentActivity';

const meta: Meta<typeof AgentStreamingBar> = {
  title: 'UI/AgentStreamingBar',
  component: AgentStreamingBar,
};

export default meta;
type Story = StoryObj<typeof AgentStreamingBar>;

interface Seed {
  id: string;
  name: string;
  status: AgentActivityStatus;
  toolCalls?: number;
}

/**
 * Seeds the singleton agent-activity store and renders the bar against it.
 * The store drives the bar via useSyncExternalStore, so the story must
 * push statuses (and reset on unmount) rather than passing props.
 */
function SeededBar({ agents }: { agents: Seed[] }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const store = getAgentActivityStore();
    store.reset();
    for (const agent of agents) {
      store.pushAgentStatus(agent.id, agent.name, agent.status, agent.toolCalls ?? 0);
    }
    setReady(true);
    return () => store.reset();
  }, [agents]);
  if (!ready) return null;
  return <AgentStreamingBar />;
}

export const SingleAgent: Story = {
  render: () => (
    <SeededBar agents={[{ id: 'a1', name: 'coder', status: 'streaming', toolCalls: 12 }]} />
  ),
};

export const MultiAgent: Story = {
  render: () => (
    <SeededBar
      agents={[
        { id: 'a1', name: 'coder', status: 'thinking', toolCalls: 3 },
        { id: 'a2', name: 'annotator', status: 'streaming', toolCalls: 7 },
        { id: 'a3', name: 'reviewer', status: 'dispatching', toolCalls: 0 },
      ]}
    />
  ),
};

export const Finished: Story = {
  render: () => (
    <SeededBar agents={[{ id: 'a1', name: 'coder', status: 'done', toolCalls: 18 }]} />
  ),
};

export const Failed: Story = {
  render: () => (
    <SeededBar agents={[{ id: 'a1', name: 'coder', status: 'failed', toolCalls: 5 }]} />
  ),
};
