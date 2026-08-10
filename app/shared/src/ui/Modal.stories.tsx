import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Modal } from './Modal';

const meta: Meta<typeof Modal> = {
  title: 'UI/Modal',
  component: Modal,
  argTypes: {
    fullscreen: { control: 'boolean' },
  },
  args: {
    title: 'Modal title',
  },
};

export default meta;
type Story = StoryObj<typeof Modal>;

/**
 * Local-state shell so the controlled Modal can demonstrate open/close and the
 * fullscreen toggle from storybook args. The shell owns `open` + `fullscreen`
 * state and re-derives the toggle handler; any caller-supplied
 * `onToggleFullscreen` is ignored in favor of the local one.
 */
function ModalShell({
  children,
  fullscreen: initialFullscreen,
  onToggleFullscreen: _onToggleFullscreen,
  ...rest
}: React.ComponentProps<typeof Modal>) {
  const [open, setOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(Boolean(initialFullscreen));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open modal</button>
      <Modal
        {...rest}
        open={open}
        fullscreen={fullscreen}
        onClose={() => setOpen(false)}
        onToggleFullscreen={() => setFullscreen((value) => !value)}
      >
        {children ?? <p>Modal body content goes here.</p>}
      </Modal>
    </>
  );
}

export const Default: Story = {
  render: (args: React.ComponentProps<typeof Modal>) => <ModalShell {...args} />,
};

export const WithTitle: Story = {
  args: { title: 'Confirm action' },
  render: (args: React.ComponentProps<typeof Modal>) => (
    <ModalShell {...args}>
      <p>Are you sure you want to continue?</p>
    </ModalShell>
  ),
};

export const WithoutTitle: Story = {
  args: { title: undefined },
  render: (args: React.ComponentProps<typeof Modal>) => (
    <ModalShell {...args}>
      <p>An overlay with no header — Esc or a backdrop click closes it.</p>
    </ModalShell>
  ),
};

export const Fullscreen: Story = {
  args: { fullscreen: true, title: 'Fullscreen modal' },
  render: (args: React.ComponentProps<typeof Modal>) => (
    <ModalShell {...args}>
      <p>This overlay fills the viewport edge-to-edge.</p>
    </ModalShell>
  ),
};

export const WithFullscreenToggle: Story = {
  args: { title: 'Toggle fullscreen' },
  render: (args: React.ComponentProps<typeof Modal>) => (
    <ModalShell {...args}>
      <p>Use the header toggle to switch between normal and fullscreen.</p>
    </ModalShell>
  ),
};

export const LongContent: Story = {
  args: { title: 'Scrollable content' },
  render: (args: React.ComponentProps<typeof Modal>) => (
    <ModalShell {...args}>
      <div>
        <p>Body scroll locks while the modal is open.</p>
        {Array.from({ length: 24 }, (_unused, index) => (
          <p key={index}>Paragraph {index + 1} of 24.</p>
        ))}
      </div>
    </ModalShell>
  ),
};
