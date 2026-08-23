import type { Meta, StoryObj } from '@storybook/react';
import { DocxPreview } from './DocxPreview';

const meta: Meta<typeof DocxPreview> = {
  title: 'UI/DocxPreview',
  component: DocxPreview,
};

export default meta;
type Story = StoryObj<typeof DocxPreview>;

// The repo carries no .docx fixture assets, so the deterministic offline
// story uses a data: URI pointing at bytes that are not a ZIP — the
// loading state renders first, then the parser surfaces its error state.
export const Default: Story = {
  args: {
    fileUrl: 'data:application/octet-stream;base64,AA==',
    fileName: 'brief.docx',
  },
};

export const WithClose: Story = {
  args: {
    fileUrl: 'data:text/plain,not a docx',
    fileName: 'brief.docx',
    onClose: () => {
      console.log('close preview');
    },
  },
};
