import type { Meta, StoryObj } from '@storybook/react';
import { TablePreview } from './TablePreview';

const meta: Meta<typeof TablePreview> = {
  title: 'UI/TablePreview',
  component: TablePreview,
};

export default meta;
type Story = StoryObj<typeof TablePreview>;

// No spreadsheet fixture lives in the repo, so the deterministic offline
// story points at a data: URI holding bytes that are not a workbook — the
// loading state renders first, then the parser surfaces its error state.
export const Default: Story = {
  args: {
    fileUrl: 'data:application/octet-stream;base64,AA==',
    fileName: 'metrics.xlsx',
  },
};

export const WithClose: Story = {
  args: {
    fileUrl: 'data:text/plain,not a workbook',
    fileName: 'metrics.xlsx',
    onClose: () => {
      console.log('close preview');
    },
  },
};
