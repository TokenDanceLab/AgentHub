import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TypingIndicator } from './TypingIndicator';

describe('TypingIndicator', () => {
  it('renders nothing when names is empty', () => {
    const { container } = render(<TypingIndicator names={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders DM typing label in DM mode', () => {
    const { getByText } = render(
      <TypingIndicator names={['Alice']} chatMode="dm" />,
    );
    // In test env without i18n backend, the raw key is shown
    expect(getByText('typing.dm')).toBeInTheDocument();
  });

  it('renders single user typing in group mode', () => {
    const { getByText } = render(
      <TypingIndicator names={['Alice']} chatMode="group" />,
    );
    expect(getByText('typing.single')).toBeInTheDocument();
  });

  it('renders two users typing in group mode', () => {
    const { getByText } = render(
      <TypingIndicator names={['Alice', 'Bob']} chatMode="group" />,
    );
    expect(getByText('typing.double')).toBeInTheDocument();
  });

  it('renders multiple users typing in group mode', () => {
    const { getByText } = render(
      <TypingIndicator names={['Alice', 'Bob', 'Charlie']} chatMode="group" />,
    );
    expect(getByText('typing.multiple')).toBeInTheDocument();
  });

  it('has aria-live polite region for accessibility', () => {
    const { getByText } = render(
      <TypingIndicator names={['Alice']} chatMode="group" />,
    );
    const parent = getByText('typing.single').closest('[aria-live]');
    expect(parent).toHaveAttribute('aria-live', 'polite');
  });
});
