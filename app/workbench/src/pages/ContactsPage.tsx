import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from './ContactsPage.module.css';
import {
  AddContactModal,
  ContactMain,
  ContactNav,
} from './contacts';
import type { ContactsPageProps } from './contacts';

/* ═══════════════════════════════════════════════════════════════════════
   ContactsPage — pure presentational workbench page

   Subcomponents / types extracted under ./contacts:
   - Phase 17 #561: types, shared, rows, AddContactModal
   - Phase 18 #574: ContactNav + ContactMain (pane cluster / profile)
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  FriendRequestRow,
  HubContactRow,
  HubSearchResultRow,
  ContactMember,
  ContactGroup,
  ServiceDesk,
  ContactsPane,
  ContactModalTab,
  ContactProfile,
  ContactsPageProps,
} from './contacts';

// ── Main component ──

export function ContactsPage(props: ContactsPageProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const {
    modalOpen = false,
    onModalClose,
    onCopyInvite,
    onSendPhoneInvite,
    error,
  } = props;

  // #1821: a failed contacts request must render an explicit error state
  // instead of collapsing into the empty list.
  if (error) {
    return (
      <section className={`${styles.page} workbench contacts-page`}>
        <div role="alert">
          <h2>{t('contacts.error.title')}</h2>
          <p>{error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.page} workbench contacts-page`}>
      <ContactNav {...props} />
      <ContactMain {...props} />

      {modalOpen && (
        <AddContactModal
          onClose={onModalClose}
          onCopyInvite={onCopyInvite}
          onSendPhoneInvite={onSendPhoneInvite}
        />
      )}
    </section>
  );
}
