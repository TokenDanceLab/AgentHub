import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { IMMessageInput } from '@/components/IM';

describe('IMMessageInput', () => {
  it('renders textarea and send button', () => {
    render(<IMMessageInput onSend={vi.fn()} />);
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
    expect(screen.getByLabelText('Send message')).toBeInTheDocument();
  });

  it('calls onSend with trimmed content when send button clicked', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'Hello!' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(onSend).toHaveBeenCalledWith('Hello!');
  });

  it('calls onSend on Enter key', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('Test');
  });

  it('does not send on Shift+Enter', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send empty message', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send whitespace-only message', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears input after send', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Sent' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('');
  });

  it('disables send button when disabled prop is true', () => {
    render(<IMMessageInput onSend={vi.fn()} disabled />);
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('shows character count', () => {
    render(<IMMessageInput onSend={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    expect(screen.getByText('5/2000')).toBeInTheDocument();
  });

  it('uses custom placeholder', () => {
    render(<IMMessageInput onSend={vi.fn()} placeholder="Say something..." />);
    expect(screen.getByPlaceholderText('Say something...')).toBeInTheDocument();
  });

  it('does not send when disabled and Enter is pressed', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} disabled />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'Should not send' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('trims whitespace before sending', () => {
    const onSend = vi.fn();
    render(<IMMessageInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: '  Hello  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('Hello');
  });
});
