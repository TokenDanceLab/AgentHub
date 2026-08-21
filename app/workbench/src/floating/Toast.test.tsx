import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DemoToast } from './DemoToast';

describe('DemoToast a11y', () => {
  it('renders a polite status live region with the message', () => {
    const { getByRole } = render(<DemoToast message="已复制" visible />);
    const toast = getByRole('status');
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast.textContent).toBe('已复制');
  });

  it('keeps the live region mounted while hidden so message swaps announce', () => {
    const { getByRole, rerender } = render(<DemoToast message="a" visible={false} />);
    expect(getByRole('status')).toBeInTheDocument();
    rerender(<DemoToast message="b" visible />);
    expect(getByRole('status').textContent).toBe('b');
  });
});
