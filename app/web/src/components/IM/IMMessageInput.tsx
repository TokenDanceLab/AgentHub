import { useState, useRef, useCallback, memo } from 'react';
import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  placeholder,
}: IMMessageInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedPlaceholder = placeholder ?? t('im.input.placeholder');

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
            placeholder={resolvedPlaceholder}
            disabled={disabled}
            rows={1}
            aria-label={t('im.input.label')}
          />
          <div className={styles.footer}>
            <span className={styles.hint}>
              {t('im.input.enterHint')}
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
          aria-label={t('im.input.send')}
          title={t('im.input.send')}
          type="button"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
});

export default IMMessageInput;
