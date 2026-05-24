// IMMessageInput.tsx — IM chat input with auto-resize textarea.
// Enter to send, Shift+Enter for newline. Similar to PromptInput but
// scoped to IM messaging without agent mentions.

import { useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import styles from './IMMessageInput.module.css';

export interface IMMessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function IMMessageInput({
  onSend,
  disabled = false,
  placeholder,
}: IMMessageInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');

  // ── Auto-resize textarea ────────────────────────
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 8 * 24) + 'px';
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [adjustHeight, value]);

  // ── Send handler ────────────────────────────────
  const handleSend = useCallback(() => {
    const content = value.trim();
    if (!content || disabled) return;
    onSend(content);
    setValue('');
    textareaRef.current?.focus();
  }, [value, onSend, disabled]);

  // ── Keyboard handler ────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const isEmpty = value.trim().length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder={placeholder ?? t('im.input.placeholder')}
            disabled={disabled}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label={t('im.input.placeholder')}
          />
          <div className={styles.inputFooter}>
            <span className={styles.enterHint}>
              <kbd className={styles.shortcutKey}>Enter</kbd>
              <span>{t('im.input.enterHint')}</span>
            </span>
          </div>
        </div>

        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={disabled || isEmpty}
          title={t('im.input.send')}
          aria-label={t('im.input.send')}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
