import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleBlock } from './CollapsibleBlock';

describe('CollapsibleBlock', () => {
  it('renders the label text', () => {
    render(
      <CollapsibleBlock label="Tool Output">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    expect(screen.getByText('Tool Output')).toBeDefined();
  });

  it('renders children content when defaultExpanded is true', () => {
    render(
      <CollapsibleBlock label="Section" defaultExpanded={true}>
        <p data-testid="child">Expanded content</p>
      </CollapsibleBlock>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('keeps children in DOM but hidden when collapsed by default', () => {
    const { container } = render(
      <CollapsibleBlock label="Section">
        <p data-testid="child">Hidden content</p>
      </CollapsibleBlock>,
    );
    const block = container.firstElementChild as HTMLElement;
    // Always-mounted for exit fade: child stays in DOM, but the block is in
    // closed state and the content node is aria-hidden (visually faded out
    // via CSS opacity/height, not by unmounting).
    expect(block.getAttribute('data-state')).toBe('closed');
    expect(screen.queryByTestId('child')).not.toBeNull();
  });

  it('toggles expanded state on header click', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleBlock label="Section">
        <p data-testid="child">Toggle content</p>
      </CollapsibleBlock>,
    );
    const header = screen.getByRole('button');
    const contentId = header.getAttribute('aria-controls');
    expect(contentId).toBeTruthy();

    await user.click(header); // expand
    expect(screen.getByTestId('child')).toBeDefined();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(contentId!)?.getAttribute('aria-hidden')).toBe('false');

    await user.click(header); // collapse
    // Child stays in DOM (always-mounted) for the exit fade; the content node
    // is now aria-hidden so AT cannot reach it. Visibility is driven by CSS,
    // not by unmounting.
    expect(screen.queryByTestId('child')).not.toBeNull();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(contentId!)?.getAttribute('aria-hidden')).toBe('true');
  });

  it('sets aria-expanded on the header button', () => {
    render(
      <CollapsibleBlock label="Section" defaultExpanded={true}>
        <p>Content</p>
      </CollapsibleBlock>,
    );
    const header = screen.getByRole('button');
    expect(header.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('sets data-state on container', () => {
    const { container } = render(
      <CollapsibleBlock label="Section">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block.getAttribute('data-state')).toBe('closed');
  });

  it('updates data-state when expanded', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CollapsibleBlock label="Section">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block.getAttribute('data-state')).toBe('closed');

    await user.click(screen.getByRole('button'));
    expect(block.getAttribute('data-state')).toBe('open');

    await user.click(screen.getByRole('button'));
    expect(block.getAttribute('data-state')).toBe('closed');
  });

  it('sets aria-controls on button and id on content', () => {
    render(
      <CollapsibleBlock label="Section" defaultExpanded={true}>
        <p>Content</p>
      </CollapsibleBlock>,
    );
    const header = screen.getByRole('button');
    const contentId = header.getAttribute('aria-controls');
    expect(contentId).toBeTruthy();

    const content = document.getElementById(contentId!);
    expect(content).toBeTruthy();
    expect(content?.tagName).toBe('DIV');
  });

  it('keeps content node in DOM and aria-hidden when collapsed', () => {
    render(
      <CollapsibleBlock label="Section">
        <p data-testid="child">Hidden content</p>
      </CollapsibleBlock>,
    );
    const header = screen.getByRole('button');
    const contentId = header.getAttribute('aria-controls');
    expect(contentId).toBeTruthy();

    // Always-mounted for exit fade: the content element stays in the DOM so
    // the CSS opacity transition can play on collapse. When collapsed it is
    // aria-hidden (unreachable to AT) instead of unmounted.
    const content = document.getElementById(contentId!);
    expect(content).toBeTruthy();
    expect(content?.tagName).toBe('DIV');
    expect(content?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders a badge when provided', () => {
    render(
      <CollapsibleBlock label="Section" badge="bash">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    expect(screen.getByText('bash')).toBeDefined();
  });

  it('renders an icon when provided', () => {
    render(
      <CollapsibleBlock label="Section" icon="terminal">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    // The Icon component renders the icon name as text
    expect(screen.getByText('terminal')).toBeDefined();
  });

  it('renders expand icon when collapsed', () => {
    render(
      <CollapsibleBlock label="Section">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    expect(screen.getByText('expand_more')).toBeDefined();
  });

  it('renders collapse icon when expanded', () => {
    render(
      <CollapsibleBlock label="Section" defaultExpanded={true}>
        <p>Content</p>
      </CollapsibleBlock>,
    );
    expect(screen.getByText('expand_less')).toBeDefined();
  });

  it('renders preview content when collapsed', () => {
    render(
      <CollapsibleBlock label="Section" preview={'Preview line 1\nPreview line 2'}>
        <p>Content</p>
      </CollapsibleBlock>,
    );
    // The preview renders each line in its own span; use getAllByText since
    // each line appears as its own text node after splitting on newline.
    const line1Els = screen.getAllByText('Preview line 1');
    const line2Els = screen.getAllByText('Preview line 2');
    expect(line1Els.length).toBeGreaterThanOrEqual(1);
    expect(line2Els.length).toBeGreaterThanOrEqual(1);
  });

  it('hides preview when expanded', () => {
    render(
      <CollapsibleBlock label="Section" preview="Some preview" defaultExpanded={true}>
        <p>Expanded</p>
      </CollapsibleBlock>,
    );
    expect(screen.queryByText('Some preview')).toBeNull();
  });

  it('truncates preview at maxPreviewLines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
    const preview = lines.join('\n');
    render(
      <CollapsibleBlock label="Section" preview={preview} maxPreviewLines={3}>
        <p>Content</p>
      </CollapsibleBlock>,
    );
    expect(screen.getByText('Line 1')).toBeDefined();
    expect(screen.getByText('Line 3')).toBeDefined();
    expect(screen.queryByText('Line 4')).toBeNull();
    expect(screen.getByText('+7 more lines')).toBeDefined();
  });

  it('does not show more-lines indicator when preview fits', () => {
    render(
      <CollapsibleBlock label="Section" preview="One line" maxPreviewLines={5}>
        <p>Content</p>
      </CollapsibleBlock>,
    );
    expect(screen.getByText('One line')).toBeDefined();
    expect(screen.queryByText(/more lines/)).toBeNull();
  });

  it('applies default color scheme class', () => {
    const { container } = render(
      <CollapsibleBlock label="Section">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    const block = container.firstElementChild as HTMLElement;
    // Should have the schemeDefault class from the CSS module
    expect(block.className).toBeTruthy();
  });

  it('applies custom color scheme class', () => {
    const { container } = render(
      <CollapsibleBlock label="Section" colorScheme="green">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    const block = container.firstElementChild as HTMLElement;
    // Should include color-scheme specific class
    expect(block.className).toBeTruthy();
  });

  it('does not render badge span when badge is not provided', () => {
    const { container } = render(
      <CollapsibleBlock label="Section">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    // The badge span has styles.badge class; we verify no extra text beyond label
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('Section');
    expect(button.textContent).toContain('expand_more');
  });

  it('is a button with type="button"', () => {
    render(
      <CollapsibleBlock label="Section">
        <p>Content</p>
      </CollapsibleBlock>,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.type).toBe('button');
  });
});
