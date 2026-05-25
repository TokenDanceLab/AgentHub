import { useState, useMemo, useCallback, memo } from 'react';
import { MessageCircle, Plus, UserPlus, Users } from 'lucide-react';
import type { ContactInfo } from '@/api/hubClient';
import type { IMContact } from './types';
import styles from './IMContactList.module.css';

type ComposeMode = 'contact' | 'private' | 'group';

interface IMContactListProps {
  contacts: IMContact[];
  hubContacts?: ContactInfo[];
  onSelect?: (contact: IMContact) => void;
  onAddContact?: (userId: string) => boolean | void | Promise<boolean | void>;
  onCreatePrivateSession?: (userId: string) => boolean | void | Promise<boolean | void>;
  onCreateGroupSession?: (name: string, memberIds: string[]) => boolean | void | Promise<boolean | void>;
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
  hubContacts = [],
  onSelect,
  onAddContact,
  onCreatePrivateSession,
  onCreateGroupSession,
  selectedId,
}: IMContactListProps) {
  const [search, setSearch] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>('contact');
  const [targetUserId, setTargetUserId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const canCompose = Boolean(onAddContact || onCreatePrivateSession || onCreateGroupSession);

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const lower = search.toLowerCase();
    return contacts.filter((c) => c.name.toLowerCase().includes(lower));
  }, [contacts, search]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      let accepted: boolean | void = false;
      if (composeMode === 'group') {
        const memberIds = groupMembers.map((id) => id.trim()).filter(Boolean);
        if (groupName.trim() && memberIds.length > 0) {
          accepted = await onCreateGroupSession?.(groupName.trim(), memberIds);
        }
      } else if (targetUserId.trim()) {
        accepted = composeMode === 'private'
          ? await onCreatePrivateSession?.(targetUserId.trim())
          : await onAddContact?.(targetUserId.trim());
      }

      if (accepted === false) return;
      setTargetUserId('');
      setGroupName('');
      setGroupMembers([]);
      setShowCompose(false);
    } finally {
      setSubmitting(false);
    }
  }, [
    composeMode,
    groupMembers,
    groupName,
    onAddContact,
    onCreateGroupSession,
    onCreatePrivateSession,
    submitting,
    targetUserId,
  ]);

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') void handleSubmit();
      if (e.key === 'Escape') setShowCompose(false);
    },
    [handleSubmit],
  );

  const toggleGroupMember = useCallback((userId: string) => {
    setGroupMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Contacts</span>
        {canCompose && (
          <button
            className={styles.addBtn}
            onClick={() => setShowCompose((v) => !v)}
            aria-label={showCompose ? 'Cancel Hub compose' : 'Open Hub compose'}
            title={showCompose ? 'Cancel' : 'Hub actions'}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {showCompose && canCompose && (
        <div className={styles.composeForm}>
          <div className={styles.composeModes} aria-label="Hub compose mode">
            {onAddContact && (
              <button
                type="button"
                className={`${styles.modeBtn} ${composeMode === 'contact' ? styles.modeBtnActive : ''}`}
                onClick={() => setComposeMode('contact')}
                aria-pressed={composeMode === 'contact'}
                aria-label="Add contact"
                title="Add contact"
              >
                <UserPlus size={14} />
              </button>
            )}
            {onCreatePrivateSession && (
              <button
                type="button"
                className={`${styles.modeBtn} ${composeMode === 'private' ? styles.modeBtnActive : ''}`}
                onClick={() => setComposeMode('private')}
                aria-pressed={composeMode === 'private'}
                aria-label="Create direct chat"
                title="Create direct chat"
              >
                <MessageCircle size={14} />
              </button>
            )}
            {onCreateGroupSession && (
              <button
                type="button"
                className={`${styles.modeBtn} ${composeMode === 'group' ? styles.modeBtnActive : ''}`}
                onClick={() => setComposeMode('group')}
                aria-pressed={composeMode === 'group'}
                aria-label="Create group chat"
                title="Create group chat"
              >
                <Users size={14} />
              </button>
            )}
          </div>

          {composeMode === 'group' ? (
            <>
              <input
                className={styles.addInput}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={handleAddKeyDown}
                placeholder="Group name..."
                autoFocus
                aria-label="Group name"
              />
              <div className={styles.memberPicker} aria-label="Group members">
                {hubContacts.length === 0 ? (
                  <span className={styles.memberEmpty}>No Hub contacts available</span>
                ) : (
                  hubContacts.map((contact) => (
                    <label className={styles.memberOption} key={contact.user_id}>
                      <input
                        type="checkbox"
                        checked={groupMembers.includes(contact.user_id)}
                        onChange={() => toggleGroupMember(contact.user_id)}
                      />
                      <span>{contact.remark ?? contact.nickname ?? contact.username}</span>
                    </label>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {composeMode === 'private' && hubContacts.length > 0 && (
                <select
                  className={styles.addInput}
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  aria-label="Hub contact"
                >
                  <option value="">Choose a Hub contact...</option>
                  {hubContacts.map((contact) => (
                    <option key={contact.user_id} value={contact.user_id}>
                      {contact.remark ?? contact.nickname ?? contact.username}
                    </option>
                  ))}
                </select>
              )}
              <input
                className={styles.addInput}
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                onKeyDown={handleAddKeyDown}
                placeholder="Hub user ID..."
                autoFocus
                aria-label="Hub user ID"
              />
            </>
          )}

          <button className={styles.addConfirm} onClick={() => void handleSubmit()} disabled={submitting}>
            {composeMode === 'contact' ? 'Add' : 'Create'}
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
                  {contact.authority ? ` | ${contact.authority}` : ''}
                  {contact.lastSeen ? ` | ${contact.lastSeen}` : ''}
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
