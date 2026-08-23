import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserPreview } from './BrowserPreview';

describe('BrowserPreview sandbox + scheme gating', () => {
  it('sandboxes remote URLs and sets no-referrer', () => {
    const { container } = render(
      <BrowserPreview url="https://example.com" onClose={vi.fn()} />,
    );
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
});
