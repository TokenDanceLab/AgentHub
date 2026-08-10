import React, { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ToastContainer } from './ToastStack';
import { useToastStore } from './toastStore';

const meta: Meta<typeof ToastContainer> = {
  title: 'UI/ToastStack',
  component: ToastContainer,
};

export default meta;
type Story = StoryObj<typeof ToastContainer>;

type ToastVariant = 'info' | 'success' | 'warning' | 'error';
type DemoVariant = ToastVariant | 'all' | 'action';

/**
 * Fires the requested toast(s) once on mount so the story renders with a
 * visible toast. Clears stale toasts from the singleton store first so
 * navigating between stories doesn't accumulate cross-story state. The store
 * keeps its real auto-dismiss (4s) and hover/focus-pause behavior, so these
 * stories also exercise auto-dismiss and hover-to-pause.
 */
function ToastLauncher({ variant }: { variant: DemoVariant }) {
  const showToast = useToastStore((state) => state.showToast);

  useEffect(() => {
    useToastStore.setState({ toasts: [] });
    switch (variant) {
      case 'info':
        showToast('info', 'For your information: a new build finished.');
        break;
      case 'success':
        showToast('success', 'Changes saved successfully.');
        break;
      case 'warning':
        showToast('warning', 'Proceed with caution — this cannot be undone.');
        break;
      case 'error':
        showToast('error', 'Failed to publish — check the logs.');
        break;
      case 'all':
        showToast('info', 'Info: a new build finished.');
        showToast('success', 'Success: changes saved.');
        showToast('warning', 'Warning: this action cannot be undone.');
        showToast('error', 'Error: failed to publish.');
        break;
      case 'action':
        showToast('error', 'Deploy failed.', {
          action: { label: 'Retry', onClick: () => {} },
        });
        break;
    }
  }, [variant, showToast]);

  return (
    <div style={{ minHeight: 320, padding: 24 }}>
      <p>
        Toast auto-dismisses after 4s. Hover (or focus) a toast to pause the
        timer; move away to resume.
      </p>
      <ToastContainer />
    </div>
  );
}

export const Info: Story = { render: () => <ToastLauncher variant="info" /> };
export const Success: Story = { render: () => <ToastLauncher variant="success" /> };
export const Warning: Story = { render: () => <ToastLauncher variant="warning" /> };
export const Error: Story = { render: () => <ToastLauncher variant="error" /> };
export const AllVariants: Story = { render: () => <ToastLauncher variant="all" /> };
export const WithAction: Story = { render: () => <ToastLauncher variant="action" /> };
