import { useState, useRef, useCallback, memo } from 'react';
import { Send } from 'lucide-react';
import styles from './IMMessageInput.module.css';

const MAX_CHARS = 2000;

interface IMMessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const IMMessageInput = memo(function IMMessageInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
}: IMMessageInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      // Auto-resize
      e.target.style.height = 'auto';
      e.target.style.height = e.target.scrollHeight + 'px';
    },
    [],
  );

  const overLimit = value.length > MAX_CHARS;

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            aria-label="Message input"
          />
          <div className={styles.footer}>
            <span className={styles.hint}>
              <kbd>Enter</kbd> to send
            </span>
            <span className={`${styles.charCount} ${overLimit ? styles.charCountOver : ''}`}>
              {value.length}/{MAX_CHARS}
            </span>
          </div>
        </div>

        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={disabled || value.trim().length === 0}
          aria-label="Send message"
          title="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
});

export default IMMessageInput;
