import { useState, useMemo, useCallback, memo } from 'react';
import { MessageSquare, Plus, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@shared/ui';
import type { IMContact } from './types';
import IMSearchBar from './IMSearchBar';
import IMSessionActions from './IMSessionActions';
import styles from './IMContactList.module.css';

interface IMContactListProps {
  contacts: IMContact[];
  onSelect?: (contact: IMContact) => void;
  onAdd?: (name: string) => void;
  selectedId?: string | undefined;
  sortBy?: 'recent' | 'pinned' | 'name';
  onSortChange?: (sort: 'recent' | 'pinned' | 'name') => void;
  showArchived?: boolean;
  onToggleShowArchived?: () => void;
  onPinToggle?: (sessionId: string) => void;
  onArchiveToggle?: (sessionId: string) => void;
  onMuteToggle?: (sessionId: string) => void;
  onSearchSessions?: (query: string) => void;
  onClearSearch?: () => void;
}

function avatarClass(type: string): string {
  switch (type) {
    case 'agent':
      return styles.itemAvatarAgent ?? '';
    case 'group':
      return styles.itemAvatarGroup ?? '';
    default:
      return styles.itemAvatarUser ?? '';
  }
}

export type SortOption = 'recent' | 'pinned' | 'name';

const IMContactList = memo(function IMContactList({
  contacts,
  onSelect,
  onAdd,
  selectedId,
  sortBy = 'recent',
  onSortChange,
  showArchived = false,
  onToggleShowArchived,
  onPinToggle,
  onArchiveToggle,
  onMuteToggle,
  onSearchSessions,
  onClearSearch,
}: IMContactListProps) {
  const { t } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');

  const sorted = useMemo(() => {
    const list = [...contacts];
    // Filter out archived unless explicitly shown
    const filtered = showArchived ? list : list.filter((c) => !c.archived);

    switch (sortBy) {
      case 'pinned':
        return filtered.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '');
        });
      case 'name':
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
      case 'recent':
      default:
        return filtered.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '');
        });
    }
  }, [contacts, sortBy, showArchived]);

  const handleAdd = useCallback(() => {
    const trimmed = addName.trim();
    if (!trimmed) return;
    onAdd?.(trimmed);
    setAddName('');
    setShowAdd(false);
  }, [addName, onAdd]);

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleAdd();
      if (e.key === 'Escape') setShowAdd(false);
    },
    [handleAdd],
  );

  const sortOptions: { key: SortOption; label: string }[] = [
    { key: 'recent', label: t('im.sort.recent') },
    { key: 'pinned', label: t('im.sort.pinned') },
    { key: 'name', label: t('im.sort.name') },
  ];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{t('im.contact.title')}</span>
        <button
          className={styles.addBtn}
          onClick={() => setShowAdd((v) => !v)}
          aria-label={showAdd ? t('im.contact.cancelAdd') : t('im.contact.add')}
          title={showAdd ? t('im.contact.cancel') : t('im.contact.add')}
          type="button"
        >
          <Plus size={14} />
        </button>
      </div>

      {showAdd && (
        <div className={styles.addForm}>
          <input
            className={styles.addInput}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder={t('im.contact.namePlaceholder')}
            autoFocus
            aria-label={t('im.contact.nameLabel')}
          />
          <button className={styles.addConfirm} onClick={handleAdd} type="button">
            {t('im.contact.addConfirm')}
          </button>
        </div>
      )}

      <IMSearchBar
        onSearch={onSearchSessions}
        onClear={onClearSearch}
      />

      {/* Sort controls */}
      <div className={styles.sortBar}>
        <div className={styles.sortGroup}>
          {sortOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`${styles.sortBtn} ${sortBy === opt.key ? styles.sortBtnActive : ''}`}
              onClick={() => onSortChange?.(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {onToggleShowArchived && (
          <button
            type="button"
            className={`${styles.archiveToggle} ${showArchived ? styles.archiveToggleActive : ''}`}
            onClick={onToggleShowArchived}
            title={showArchived ? t('im.hideArchived') : t('im.showArchived')}
          >
            {showArchived ? t('im.hideArchived') : t('im.showArchived')}
          </button>
        )}
      </div>

      <div className={styles.list} role={sorted.length === 0 ? undefined : 'listbox'} aria-label={sorted.length === 0 ? undefined : t('im.contact.title')}>
        {sorted.length === 0 ? (
          <EmptyState
            className={styles.empty ?? ''}
            iconClassName={styles.emptyIcon ?? ''}
            titleClassName={styles.emptyTitle ?? ''}
            descriptionClassName={styles.emptyDescription ?? ''}
            icon={<MessageSquare size={18} />}
            title={t('im.contact.empty')}
            description={t('im.contact.emptyDescription')}
            titleLevel={3}
          />
        ) : (
          sorted.map((contact) => (
            <div
              key={contact.id}
              className={`${styles.item} ${selectedId === contact.id ? styles.itemSelected : ''}`}
              role="option"
              aria-selected={selectedId === contact.id}
              onClick={() => onSelect?.(contact)}
            >
              <div className={`${styles.itemAvatar} ${avatarClass(contact.type)}`}>
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className={styles.itemInfo}>
                <div className={styles.itemNameRow}>
                  <span className={styles.itemName}>{contact.name}</span>
                  {contact.pinned && (
                    <Pin size={10} className={styles.pinIcon} aria-label={t('im.pinned')} />
                  )}
                  {contact.muted && (
                    <span className={styles.mutedBadge} aria-label={t('im.muted')}>
                      {t('im.muted')}
                    </span>
                  )}
                </div>
                <div className={styles.itemMeta}>
                  {contact.type}
                  {contact.authority ? ` · ${contact.authority}` : ''}
                  {contact.lastSeen ? ` · ${contact.lastSeen}` : ''}
                </div>
              </div>
              <IMSessionActions
                pinned={contact.pinned}
                archived={contact.archived}
                muted={contact.muted}
                onPin={() => onPinToggle?.(contact.id)}
                onUnpin={() => onPinToggle?.(contact.id)}
                onArchive={() => onArchiveToggle?.(contact.id)}
                onUnarchive={() => onArchiveToggle?.(contact.id)}
                onMute={() => onMuteToggle?.(contact.id)}
                onUnmute={() => onMuteToggle?.(contact.id)}
              />
              <div
                className={`${styles.onlineDot} ${
                  contact.online ? styles.onlineDotOn : styles.onlineDotOff
                }`}
                aria-label={contact.online ? t('im.contact.online') : t('im.contact.offline')}
                title={contact.online ? t('im.contact.online') : t('im.contact.offline')}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export default IMContactList;
