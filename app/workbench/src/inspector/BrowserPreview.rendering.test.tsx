import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserPreview } from './BrowserPreview';

describe('BrowserPreview sandbox + scheme gating', () => {
  it('sandboxes remote URLs and sets no-referrer', () => {
    const { container } = render(
      <BrowserPreview url="https://example.com" onClose={vi.fn()} />,
    );
    const region = container.querySelector('section');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('tabindex', '-1');
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe!.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe!.getAttribute('src')).toBe('https://example.com');
  });

  it('blocks unsafe schemes with a notice instead of an iframe', () => {
    const { container } = render(
      <BrowserPreview url="javascript:alert(1)" onClose={vi.fn()} />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[role="note"]')).not.toBeNull();
  });

  it('sandboxes blank srcDoc previews', () => {
    const { container } = render(
      <BrowserPreview url="about:blank" onClose={vi.fn()} />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe!.hasAttribute('srcDoc')).toBe(true);
  });

  it('reloads the iframe when the refresh button is clicked (#1871 item 2)', () => {
    const { container, getByRole } = render(
      <BrowserPreview url="https://example.com" onClose={vi.fn()} />,
    );
    const before = container.querySelector('iframe');
    expect(before).not.toBeNull();

    fireEvent.click(getByRole('button', { name: 'aria.refresh' }));

    const after = container.querySelector('iframe');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('status bar shows factual sandbox/read-only state, not hardcoded surface claims (#1946)', () => {
    const { container } = render(
      <BrowserPreview url="https://example.com" onClose={vi.fn()} />,
    );
    // No surface/origin claims that are wrong on at least one surface.
    expect(container.textContent).not.toContain('Local Vite');
    expect(container.textContent).not.toContain('Desktop');
    // Factual, i18n-driven state instead (test env renders raw keys).
    expect(container.textContent).toContain('browserPreview.sandboxed');
    expect(container.textContent).toContain('browserPreview.readOnly');
  });
});
