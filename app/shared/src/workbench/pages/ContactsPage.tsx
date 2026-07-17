import React from 'react';
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
  const {
    modalOpen = false,
    onModalClose,
    onCopyInvite,
    onSendPhoneInvite,
  } = props;

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
