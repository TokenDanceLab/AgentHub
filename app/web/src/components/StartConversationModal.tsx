import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '@shared/ui/Modal';
import type { ContactMember } from '@agenthub/workbench';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './StartConversationModal.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   StartConversationModal — web-side "新建会话" peer picker (#1819).

   The Hub session model requires a peer target (`createPrivateSession` with
   `target_user_id`); unlike the Desktop Edge thread model there is no
   blank-session API. The sidebar button therefore opens this modal over the
   real contact list (already loaded by the shell), and selecting a member
   runs the existing createPrivateSession chain. The create call and its
   visible error state are owned by the shell (App.tsx); this component is
   presentational (filter + list + busy/error display).
   ═══════════════════════════════════════════════════════════════════════ */

interface StartConversationModalProps {
  open: boolean;
  /** Real contact list for the current user (already resolved via Hub). */
  members: ContactMember[];
  /** A create-private-session call is in flight (rows disabled). */
  busy?: boolean | undefined;
  /** Visible create error (kept in the modal until retry/close — not swallowed). */
  error?: string | undefined;
  /** Called with the picked peer; the shell creates the session and selects it. */
  onStart: (member: ContactMember) => void;
  onClose: () => void;
}

export function StartConversationModal({
  open,
  members,
  busy,
  error,
  onStart,
  onClose,
}: StartConversationModalProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [query, setQuery] = useState('');

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => member.name.toLowerCase().includes(q));
  }, [members, query]);

  return (
    <Modal onClose={onClose} open={open} title={t('newConversation.title')}>
      <div className={styles.body}>
        <input
          aria-label={t('newConversation.searchPlaceholder')}
          className={styles.search}
          disabled={busy}
          placeholder={t('newConversation.searchPlaceholder')}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {filteredMembers.length === 0 ? (
          <p className={styles.empty}>{t('newConversation.empty')}</p>
        ) : (
          <ul className={styles.list}>
            {filteredMembers.map((member) => (
              <li key={member.id}>
                <button
                  className={styles.contactRow}
                  disabled={busy}
                  type="button"
                  onClick={() => onStart(member)}
                >
                  <span className={styles.avatar} aria-hidden="true">
                    {member.initials}
                  </span>
                  <span className={styles.contactName}>{member.name}</span>
                  <span className={styles.contactOrg}>{member.org}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <button
            className={styles.cancel}
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            {t('conversation.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
