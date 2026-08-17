import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

// Mock react-syntax-highlighter so we don't load the heavy Prism bundle.
// CodeBlock lazy-imports PrismLight + oneDark; we stub them to render raw code.
vi.mock('react-syntax-highlighter', () => ({
  PrismLight: ({ code }: { code: string }) =>
    React.createElement('pre', null, React.createElement('code', null, code)),
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
}));
vi.mock('./prismRegistry', () => ({}));

// Mock clipboard so the copy button can be exercised.
const writeText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText },
  configurable: true,
});

import { CodeBlock } from './CodeBlock';

describe('CodeBlock', () => {
  it('renders inline code (no language, no trailing newline) as <code>', () => {
    render(<CodeBlock>inline snippet</CodeBlock>);
    expect(screen.getByText('inline snippet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders block code with language label and copy button', () => {
    render(
      <CodeBlock className="language-typescript">
        {'const x = 1;\n'}
      </CodeBlock>,
    );
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    const copyBtn = screen.getByRole('button', { name: 'code.copy' });
    expect(copyBtn).toBeInTheDocument();
  });

  it('shows code.copied aria-label after clicking copy', async () => {
    render(
      <CodeBlock className="language-python">
        {'print("hello")\n'}
      </CodeBlock>,
    );
    const copyBtn = screen.getByRole('button', { name: 'code.copy' });
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'code.copied' })).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith('print("hello")');
  });

  it('shows collapse/expand toggle for code longer than 20 lines', () => {
    const longCode = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n') + '\n';
    render(
      <CodeBlock className="language-text">
        {longCode}
      </CodeBlock>,
    );
    const toggle = screen.getByRole('button', { name: 'code.expand' });
    expect(toggle).toBeInTheDocument();
  });

  it('does not show collapse toggle for short code', () => {
    render(
      <CodeBlock className="language-text">
        {'short\n'}
      </CodeBlock>,
    );
    expect(screen.queryByRole('button', { name: 'code.expand' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'code.collapse' })).not.toBeInTheDocument();
  });

  it('toggles between expand and collapse labels', () => {
    const longCode = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n') + '\n';
    render(
      <CodeBlock className="language-text">
        {longCode}
      </CodeBlock>,
    );
    const expandBtn = screen.getByRole('button', { name: 'code.expand' });
    fireEvent.click(expandBtn);
    expect(screen.getByRole('button', { name: 'code.collapse' })).toBeInTheDocument();
  });
});
