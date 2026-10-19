import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilePreview } from './FilePreview';

describe('FilePreview rendering', () => {
  it('renders markdown tables through the shared markdown renderer', () => {
    const { container, getByText } = render(
      <FilePreview
        filename="handoff.md"
        content={'# Handoff\n\n| Surface | Status |\n| --- | --- |\n| Desktop/Web | aligned |'}
        onClose={vi.fn()}
      />,
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(getByText('Desktop/Web')).toBeInTheDocument();
    expect(getByText('aligned')).toBeInTheDocument();
  });

  it('renders PDF previews without a sandbox (ADR-023: Chromium blocks its viewer in sandboxed frames)', () => {
    const { container } = render(
      <FilePreview
        filename="report.pdf"
        content={'data:application/pdf;base64,'}
        onClose={vi.fn()}
      />,
    );

    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame).not.toHaveAttribute('sandbox');
  });
});
