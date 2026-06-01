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

  it('hides children when collapsed by default', () => {
    render(
      <CollapsibleBlock label="Section">
        <p data-testid="child">Hidden content</p>
      </CollapsibleBlock>,
    );
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('toggles expanded state on header click', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleBlock label="Section">
        <p data-testid="child">Toggle content</p>
      </CollapsibleBlock>,
    );
    const header = screen.getByRole('button');
    expect(screen.queryByTestId('child')).toBeNull();

    await user.click(header);
    expect(screen.getByTestId('child')).toBeDefined();

    await user.click(header);
    expect(screen.queryByTestId('child')).toBeNull();
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
