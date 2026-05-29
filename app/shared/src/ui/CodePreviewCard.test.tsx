import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodePreviewCard } from './CodePreviewCard';

describe('CodePreviewCard', () => {
  it('renders a dense code preview with title and lines', () => {
    render(
      <CodePreviewCard
        title="app/mobile/src/views/RunStatusView.tsx"
        code={"+import { CodePreviewCard } from '@agenthub/shared/ui';\n-<pre>old diff</pre>"}
        meta="+1 -1"
      />,
    );

    expect(screen.getByText('app/mobile/src/views/RunStatusView.tsx')).toBeInTheDocument();
    expect(screen.getByText('+1 -1')).toBeInTheDocument();
    expect(screen.getByText("+import { CodePreviewCard } from '@agenthub/shared/ui';")).toBeInTheDocument();
    expect(screen.getByText('-<pre>old diff</pre>')).toBeInTheDocument();
  });

  it('accepts mobile class overrides and actions', () => {
    render(
      <CodePreviewCard
        title="diff.ts"
        code="export const ok = true;"
        className="mobileDiffFile"
        bodyClassName="mobileDiffCode"
        actionsClassName="mobileDiffActions"
        actions={<button type="button">Copy</button>}
      />,
    );

    const card = screen.getByText('diff.ts').closest('article');

    expect(card).toHaveClass('mobileDiffFile');
    expect(card).toHaveAttribute('data-has-actions', 'true');
    expect(card?.querySelector('.mobileDiffCode')).toHaveTextContent('export const ok = true;');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('can cap long previews without hiding that more lines exist', () => {
    render(
      <CodePreviewCard
        title="large.patch"
        code={'one\ntwo\nthree'}
        maxLines={2}
      />,
    );

    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByText('three')).not.toBeInTheDocument();
    expect(screen.getByText('+1 more lines')).toBeInTheDocument();
  });
});
