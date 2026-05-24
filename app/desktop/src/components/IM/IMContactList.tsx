import { useState, useMemo, useCallback, memo } from 'react';
import { Plus } from 'lucide-react';
import type { IMContact } from './types';
import styles from './IMContactList.module.css';

interface IMContactListProps {
  contacts: IMContact[];
  onSelect?: (contact: IMContact) => void;
  onAdd?: (name: string) => void;
  selectedId?: string;
}

function avatarClass(type: string): string {
  switch (type) {
    case 'agent':
      return styles.itemAvatarAgent;
    case 'group':
      return styles.itemAvatarGroup;
    default:
      return styles.itemAvatarUser;
  }
}

const IMContactList = memo(function IMContactList({
  contacts,
  onSelect,
  onAdd,
  selectedId,
}: IMContactListProps) {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const lower = search.toLowerCase();
    return contacts.filter((c) => c.name.toLowerCase().includes(lower));
  }, [contacts, search]);

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

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Contacts</span>
        <button
          className={styles.addBtn}
          onClick={() => setShowAdd((v) => !v)}
          aria-label={showAdd ? 'Cancel add contact' : 'Add contact'}
          title={showAdd ? 'Cancel' : 'Add contact'}
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
            placeholder="Contact name..."
            autoFocus
            aria-label="Contact name"
          />
          <button className={styles.addConfirm} onClick={handleAdd}>
            Add
          </button>
        </div>
      )}

      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts..."
          aria-label="Search contacts"
        />
      </div>

      <div className={styles.list} role="listbox" aria-label="Contacts">
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            {search ? 'No contacts match your search' : 'No contacts yet'}
          </div>
        ) : (
          filtered.map((contact) => (
            <div
              key={contact.id}
              className={styles.item}
              role="option"
              aria-selected={selectedId === contact.id}
              onClick={() => onSelect?.(contact)}
            >
              <div className={`${styles.itemAvatar} ${avatarClass(contact.type)}`}>
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className={styles.itemInfo}>
                <div className={styles.itemName}>{contact.name}</div>
                <div className={styles.itemMeta}>
                  {contact.type}
                  {contact.authority ? ` · ${contact.authority}` : ''}
                  {contact.lastSeen ? ` · ${contact.lastSeen}` : ''}
                </div>
              </div>
              <div
                className={`${styles.onlineDot} ${
                  contact.online ? styles.onlineDotOn : styles.onlineDotOff
                }`}
                aria-label={contact.online ? 'Online' : 'Offline'}
                title={contact.online ? 'Online' : 'Offline'}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export default IMContactList;
