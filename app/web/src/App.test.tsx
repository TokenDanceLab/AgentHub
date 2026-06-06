import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

  it('mounts the shared v4 workbench shell without legacy demo chrome', () => {
    const { container } = render(<App />);
    const text = visibleText(container);

    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'web');
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Inspector tabs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agent 协作群' })).toBeInTheDocument();
    expect(text).not.toMatch(/shell\.(?:brand|toolbar|status|sidebar|statusPanel|workspace|page|source)/);
    expect(text).not.toMatch(/synced|marketplace connected|session active/i);
  });
});
