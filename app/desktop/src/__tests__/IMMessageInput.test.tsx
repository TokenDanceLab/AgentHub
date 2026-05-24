vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import IMMessageInput from '@/components/IMMessageInput';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

describe('IMMessageInput', () => {
  it('renders input field with placeholder', () => {
    render(<IMMessageInput onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    expect(input).toBeInTheDocument();
  });

  it('uses custom placeholder when provided', () => {
    render(<IMMessageInput onSend={vi.fn()} placeholder="Type here..." />);

    const input = screen.getByPlaceholderText('Type here...');
    expect(input).toBeInTheDocument();
  });

  it('calls onSend when send button is clicked with non-empty input', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    fireEvent.change(input, { target: { value: 'Hello world' } });

    const sendBtn = screen.getByRole('button', { name: 'im.input.send' });
    fireEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hello world');
  });

  it('calls onSend on Enter key', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Test message');
  });

  it('does NOT call onSend on Enter with empty input', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does NOT call onSend on Enter with whitespace-only input', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('Shift+Enter inserts newline without sending', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('im.input.placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Line 1' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    // onSend should NOT be called (Shift+Enter is for newline)
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables input and send button when disabled prop is true', () => {
    render(<IMMessageInput onSend={vi.fn()} disabled={true} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    expect(input).toBeDisabled();

    const sendBtn = screen.getByRole('button', { name: 'im.input.send' });
    expect(sendBtn).toBeDisabled();
  });

  it('disables send button when input is empty', () => {
    render(<IMMessageInput onSend={vi.fn()} />);

    const sendBtn = screen.getByRole('button', { name: 'im.input.send' });
    expect(sendBtn).toBeDisabled();
  });

  it('enables send button when input has content', () => {
    render(<IMMessageInput onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    fireEvent.change(input, { target: { value: 'Hi' } });

    const sendBtn = screen.getByRole('button', { name: 'im.input.send' });
    expect(sendBtn).not.toBeDisabled();
  });

  it('clears input after sending', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('im.input.placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Clear me' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('does NOT call onSend when disabled and Enter is pressed', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} disabled={true} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    fireEvent.change(input, { target: { value: 'Should not send' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('trims whitespace from message before sending', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('im.input.placeholder');
    fireEvent.change(input, { target: { value: '  Hello  ' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Hello');
  });
});
