import type { Meta, StoryObj } from '@storybook/react';
import { SlideshowPreview } from './SlideshowPreview';

const meta: Meta<typeof SlideshowPreview> = {
  title: 'UI/SlideshowPreview',
  component: SlideshowPreview,
};

export default meta;
type Story = StoryObj<typeof SlideshowPreview>;

// No .pptx fixture lives in the repo, so the deterministic offline story
// points at a data: URI holding bytes that are not a ZIP — the loading
// state renders first, then the parser surfaces its error state.
export const Default: Story = {
  args: {
    fileUrl: 'data:application/octet-stream;base64,AA==',
    fileName: 'team-update.pptx',
  },
};

export const WithClose: Story = {
  args: {
    fileUrl: 'data:text/plain,not a pptx',
    fileName: 'team-update.pptx',
    onClose: () => {
      console.log('close preview');
    },
  },
};
