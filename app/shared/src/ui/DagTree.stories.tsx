import type { Meta, StoryObj } from '@storybook/react';
import { DagTree, type DagNode } from './DagTree';

const meta: Meta<typeof DagTree> = {
  title: 'UI/DagTree',
  component: DagTree,
};

export default meta;
type Story = StoryObj<typeof DagTree>;

const nodes: DagNode[] = [
  {
    id: 'route-1',
    label: 'analyze → coder',
    status: 'completed',
    duration: '12s',
    children: [
      {
        id: 'agent-1',
        label: 'coder',
        status: 'in_progress',
        duration: '3m 12s',
        children: [
          { id: 'subtask-1', label: 'FileSystem.write', status: 'completed', duration: '2.1s' },
          { id: 'subtask-2', label: 'Bash.run', status: 'completed', duration: '4.4s' },
          { id: 'subtask-3', label: 'Read.read', status: 'pending' },
        ],
      },
    ],
  },
  { id: 'route-2', label: 'plan → annotator', status: 'failed', duration: '8s' },
  { id: 'route-3', label: 'review', status: 'pending' },
];

export const Default: Story = { args: { title: 'Dispatch DAG', nodes } };
export const WithoutTitle: Story = { args: { nodes: nodes.slice(1) } };
export const Empty: Story = { args: { nodes: [] } };
