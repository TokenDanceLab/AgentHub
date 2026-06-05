import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import App from '@/App';

function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('style, script').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

describe('Web app root', () => {
  afterEach(() => {
    cleanup();
  });

  it('mounts the provider shell without legacy demo chrome', () => {
    const { container } = render(<App />);
    const text = visibleText(container);

    expect(container.firstElementChild).toBeInstanceOf(HTMLDivElement);
    expect(text).toBe('');
    expect(text).not.toMatch(/shell\.(?:brand|toolbar|status|sidebar|statusPanel|workspace|page|source)/);
    expect(text).not.toMatch(/synced|marketplace connected|session active/i);
  });
});
