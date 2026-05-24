import type { ChangeEvent, KeyboardEvent } from 'react';
import styles from './ChatInput.module.css';

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function ChatInput({
  value,
  onChange,
  onSend,
  placeholder = 'Type a message...',
  disabled = false,
  className,
}: ChatInputProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (value.trim().length > 0 && !disabled) {
      onSend();
    }
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className={cx(styles.wrap, className)}>
      <div className={styles.composer}>
        <textarea
          className={styles.textarea}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          aria-label="Message input"
        />

        <button
          className={styles.sendBtn}
          onClick={onSend}
          disabled={!canSend}
          type="button"
          aria-label="Send message"
        >
          <svg
            className={styles.sendIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          Send
        </button>
      </div>
    </div>
  );
}
