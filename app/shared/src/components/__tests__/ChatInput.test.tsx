import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatInput } from '../ChatInput/ChatInput';

describe('ChatInput', () => {
  // ── Basic rendering ────────────────────────────

  it('renders a textarea and a send button', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('uses the default placeholder when none is provided', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  it('uses a custom placeholder when provided', () => {
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        placeholder="Ask something..."
      />,
    );

    expect(screen.getByPlaceholderText('Ask something...')).toBeInTheDocument();
  });

  // ── Controlled value ───────────────────────────

  it('displays the controlled value in the textarea', () => {
    render(<ChatInput value="Hello" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveValue('Hello');
  });

  it('calls onChange when the user types', () => {
    const onChange = vi.fn();
    render(<ChatInput value="" onChange={onChange} onSend={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Hi' },
    });

    expect(onChange).toHaveBeenCalledWith('Hi');
  });

  // ── Enter sends ────────────────────────────────

  it('calls onSend when Enter is pressed with non-empty value', () => {
    const onSend = vi.fn();
    render(<ChatInput value="Hello world" onChange={vi.fn()} onSend={onSend} />);

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), {
      key: 'Enter',
      shiftKey: false,
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not call onSend when Enter is pressed with empty/whitespace value', () => {
    const onSend = vi.fn();
    render(<ChatInput value="   " onChange={vi.fn()} onSend={onSend} />);

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), {
      key: 'Enter',
      shiftKey: false,
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  // ── Shift+Enter inserts newline ────────────────

  it('does not call onSend when Shift+Enter is pressed', () => {
    const onSend = vi.fn();
    render(<ChatInput value="Hello" onChange={vi.fn()} onSend={onSend} />);

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), {
      key: 'Enter',
      shiftKey: true,
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  // ── Disabled state ─────────────────────────────

  it('disables the textarea when disabled is true', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} disabled />);

    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeDisabled();
  });

  it('disables the send button when disabled is true', () => {
    render(<ChatInput value="Hello" onChange={vi.fn()} onSend={vi.fn()} disabled />);

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('does not call onSend on Enter when disabled', () => {
    const onSend = vi.fn();
    render(<ChatInput value="Hello" onChange={vi.fn()} onSend={onSend} disabled />);

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), {
      key: 'Enter',
      shiftKey: false,
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  // ── Send button click ──────────────────────────

  it('calls onSend when the send button is clicked', () => {
    const onSend = vi.fn();
    render(<ChatInput value="Hello" onChange={vi.fn()} onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('disables the send button when value is empty', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('disables the send button when value is only whitespace', () => {
    render(<ChatInput value="   " onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  // ── CSS interactions ───────────────────────────

  it('applies custom className when provided', () => {
    const { container } = render(
      <ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} className="custom-chat" />,
    );

    expect(container.firstElementChild).toHaveClass('custom-chat');
  });
});
