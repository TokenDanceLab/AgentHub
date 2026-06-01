import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

describe('Modal', () => {
  beforeEach(() => {
    // Reset body overflow between tests
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()}>
        <p>Hidden content</p>
      </Modal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders children when open', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Visible content</p>
      </Modal>,
    );
    expect(screen.getByText('Visible content')).toBeDefined();
  });

  it('closes on Escape key press', () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not listen for Escape when closed', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );
    const overlay = screen.getByRole('dialog');
    // Click the backdrop (e.currentTarget === e.target)
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside content', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <button>Inside button</button>
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: 'Inside button' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks body scroll when open', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('renders title when provided', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="My Modal">
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByText('My Modal')).toBeDefined();
  });

  it('renders close button', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Test">
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders fullscreen toggle button when onToggleFullscreen provided', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Test" onToggleFullscreen={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeDefined();
  });

  it('calls onToggleFullscreen when toggle button clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <Modal open={true} onClose={vi.fn()} title="Test" onToggleFullscreen={onToggle}>
        <p>Content</p>
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows minimize icon and exit label when fullscreen is true', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Test" onToggleFullscreen={vi.fn()} fullscreen={true}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeDefined();
  });

  it('has proper ARIA attributes', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Accessible Modal">
        <p>Content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Accessible Modal');
  });

  it('uses default aria-label when no title provided', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Modal');
  });

  it('applies overlayClassName to overlay', () => {
    render(
      <Modal open={true} onClose={vi.fn()} overlayClassName="custom-overlay">
        <p>Content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('custom-overlay');
  });

  it('applies contentClassName to content container', () => {
    render(
      <Modal open={true} onClose={vi.fn()} contentClassName="custom-content">
        <p>Content</p>
      </Modal>,
    );
    // The content div is the first child of the overlay/dialog
    const dialog = screen.getByRole('dialog');
    const content = dialog.firstElementChild as HTMLElement;
    expect(content.className).toContain('custom-content');
  });

  it('applies fullscreen class when fullscreen prop is true', () => {
    render(
      <Modal open={true} onClose={vi.fn()} fullscreen={true}>
        <p>Content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const content = dialog.firstElementChild as HTMLElement;
    expect(content.className).toContain('contentFullscreen');
  });

  it('hides header when title and onToggleFullscreen are both null', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    // Close button should not be rendered (it lives inside the header)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
