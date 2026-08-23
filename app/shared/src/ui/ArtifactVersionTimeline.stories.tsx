import type { Meta, StoryObj } from '@storybook/react';
import { ArtifactVersionTimeline, type ArtifactVersion } from './ArtifactVersionTimeline';

const meta: Meta<typeof ArtifactVersionTimeline> = {
  title: 'UI/ArtifactVersionTimeline',
  component: ArtifactVersionTimeline,
};

export default meta;
type Story = StoryObj<typeof ArtifactVersionTimeline>;

const versions: ArtifactVersion[] = [
  {
    version: 3,
    artifactId: 'art-1',
    runId: 'run-3',
    createdAt: '2026-08-23T09:00:00Z',
    summary: 'Refactored the panel to use the new token API',
  },
  {
    version: 2,
    artifactId: 'art-1',
    runId: 'run-2',
    createdAt: '2026-08-22T18:30:00Z',
    summary: 'Added dark-mode contrast fixes',
  },
  {
    version: 1,
    artifactId: 'art-1',
    runId: 'run-1',
    createdAt: '2026-08-21T11:15:00Z',
  },
];

export const Default: Story = {
  args: { artifactId: 'art-1', artifactTitle: 'Implementation report.md', versions },
};

export const ExpandedWithActions: Story = {
  args: {
    artifactId: 'art-1',
    artifactTitle: 'Implementation report.md',
    versions,
    onRevert: (versionNumber: number) => {
      console.log('revert to version', versionNumber);
    },
    onCompare: (from: number, to: number) => {
      console.log('compare', from, 'with', to);
    },
  },
};

export const SingleVersion: Story = {
  args: {
    artifactId: 'art-1',
    artifactTitle: 'Implementation report.md',
    versions: [versions[2]!],
  },
};

export const Empty: Story = {
  args: { artifactId: 'art-1', artifactTitle: 'Implementation report.md', versions: [] },
};
