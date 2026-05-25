import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatInput } from '../ChatInput/ChatInput';

describe('ChatInput', () => {
  it('sends with Enter when the draft has content', () => {
    const onSend = vi.fn();

    render(<ChatInput value="hello" onChange={vi.fn()} onSend={onSend} />);

    fireEvent.keyDown(screen.getByLabelText('Message input'), {
      key: 'Enter',
      shiftKey: false,
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('keeps Shift+Enter for multiline input', () => {
    const onSend = vi.fn();

    render(<ChatInput value="hello" onChange={vi.fn()} onSend={onSend} />);

    fireEvent.keyDown(screen.getByLabelText('Message input'), {
      key: 'Enter',
      shiftKey: true,
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send while the input method is composing', () => {
    const onSend = vi.fn();

    render(<ChatInput value="hello" onChange={vi.fn()} onSend={onSend} />);

    fireEvent.keyDown(screen.getByLabelText('Message input'), {
      key: 'Enter',
      isComposing: true,
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send blank input', () => {
    const onSend = vi.fn();

    render(<ChatInput value="   " onChange={vi.fn()} onSend={onSend} />);

    fireEvent.keyDown(screen.getByLabelText('Message input'), {
      key: 'Enter',
    });

    expect(onSend).not.toHaveBeenCalled();
  });
});
