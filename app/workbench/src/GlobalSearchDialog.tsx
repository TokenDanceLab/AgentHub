import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkbenchConversation } from '@shared/platform';
import { useFocusTrap } from '@shared/ui/focusTrap';
import { Button } from '@shared/ui/Button';
import { DesignNavIcon } from './designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './GlobalSearchDialog.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   GlobalSearchDialog — Ctrl/⌘+K dialog (#1822).

   Performs a client-side search across the workbench conversation list and
   jumps to the selected conversation. Shared by Web and Desktop shells (it
   only needs conversations + an onSelect callback), which finally gives the
   previously dead `search` shortcut a real consumer.

   Keyboard: ↑↓ navigate, Enter jump, Esc close. Click behaves like Enter.
   ═══════════════════════════════════════════════════════════════════════ */

const MAX_RESULTS = 50;

interface GlobalSearchDialogProps {
  open: boolean;
  conversations: WorkbenchConversation[];
  currentConversationId?: string;
  onClose: () => void;
  onSelect: (conversationId: string) => void;
}

export function GlobalSearchDialog({
  open,
  conversations,
  currentConversationId,
  onClose,
  onSelect,
}: GlobalSearchDialogProps): React.ReactElement | null {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  useFocusTrap(panelRef, open);

  const results = useMemo<WorkbenchConversation[]>(() => {
    const q = query.trim().toLowerCase();
    const match = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    return match.slice(0, MAX_RESULTS);
  }, [conversations, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectConversation = useCallback(
    (conversationId: string): void => {
      onSelect(conversationId);
      setQuery('');
    },
    [onSelect],
  );

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      const active = results[activeIndex];
      if (!active) return;
      e.preventDefault();
      selectConversation(active.id);
    }
  }

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={t('globalSearch.label', { defaultValue: '全局搜索' })}
      >
        <div className={styles.searchBar}>
          <DesignNavIcon className={styles.searchIcon} name="search" strokeWidth={2} />
          <input
            ref={inputRef}
            className={styles.input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('globalSearch.placeholder', { defaultValue: '搜索或切换会话…' })}
            aria-label={t('globalSearch.label', { defaultValue: '全局搜索' })}
          />
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('ui.closeSearch', { defaultValue: '关闭搜索' })}>
            <DesignNavIcon name="close" size={14} strokeWidth={2} />
          </Button>
        </div>

        <div className={styles.results}>
          {results.length === 0 && (
            <div className={styles.empty}>{t('globalSearch.empty', { defaultValue: '没有匹配的会话' })}</div>
          )}
          {results.map((conversation, idx) => (
            <button
              key={conversation.id}
              ref={idx === activeIndex ? activeRowRef : undefined}
              type="button"
              className={`${styles.resultItem} ${idx === activeIndex ? styles.resultItemActive : ''}`}
              aria-current={idx === activeIndex ? 'true' : undefined}
              onClick={() => selectConversation(conversation.id)}
            >
              <div className={styles.resultMeta}>
                <span className={styles.resultTitle}>{conversation.title}</span>
                {currentConversationId === conversation.id && (
                  <span className={styles.resultKind}>{t('globalSearch.current', { defaultValue: '当前' })}</span>
                )}
              </div>
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          {t('globalSearch.footer', { defaultValue: 'Esc 关闭 · ↑↓ 选择 · Enter 打开' })}
        </div>
      </div>
    </div>
  );
}
