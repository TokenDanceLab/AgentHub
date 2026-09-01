import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DesignNavIcon } from '../../designIcons';
import { Select } from '@shared/ui';
import { useFocusTrap } from '@shared/ui/focusTrap';
import styles from '../ContactsPage.module.css';
import { MODAL_TABS } from './shared';
import type { ContactModalTab } from './types';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';

/* ═══════════════════════════════════════════════════════════════════════
   Add-contact modal + invite panels.
   Extracted from ContactsPage as Phase 17 strangler slice #561.
   CSS remains on shared ContactsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

function QRPanel() {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  // Generate a pseudo-QR pattern (purely decorative)
  const cells = Array.from({ length: 81 }, (_, i) =>
    (i * 7 + i) % 5 < 2,
  );
  // #1821: the QR "valid until" date used to be a hardcoded literal that went
  // stale; derive it from today + 30 days instead.
  const expireLabel = React.useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return `有效期至 ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }, []);

  return (
    <div className={styles.qrPanel}>
      <div className={styles.qrCard}>
        <div className={styles.qrGrid} aria-label={t("aria.businessQr")}>
          {cells.map((on, i) => (
            <span
              key={i}
              className={on ? styles.qrCellOn : styles.qrCell}
            />
          ))}
          <b className={styles.qrCenter}>TD</b>
        </div>
      </div>
      <h3 className={styles.qrTitle}>{t('addContact.qrTitle')}</h3>
      <p className={styles.qrCopy}>
        {t('addContact.qrDescription')}
      </p>
      <span className={styles.qrExpire}>{expireLabel}</span>
    </div>
  );
}

function LinkPanel({ onCopy }: { onCopy?: (() => void) | undefined }) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const linkInputId = React.useId();
  return (
    <div className={styles.linkPanel}>
      <label className={styles.linkLabel} htmlFor={linkInputId}>{t('addContact.inviteLink')}</label>
      <div className={styles.linkCopyRow}>
        <input
          id={linkInputId}
          className={styles.linkInput}
          readOnly
          value="https://hub.example.com/invite/TD-2026"
        />
        <button type="button" className={styles.linkCopyBtn} onClick={onCopy}>
          {t('addContact.copyLink')}
        </button>
      </div>
      <p className={styles.linkHint}>
        {t('addContact.inviteLinkDescription')}
      </p>
    </div>
  );
}

function CodePanel({ onCopy }: { onCopy?: (() => void) | undefined }) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.codePanel}>
      <span className={styles.codeValue}>TD-86K2-2026</span>
      <p className={styles.linkHint}>
        {t('addContact.inviteCodeHint')}
      </p>
      <button type="button" className={styles.codeBtn} onClick={onCopy}>
        {t('addContact.copyInviteCode')}
      </button>
    </div>
  );
}

function PhonePanel({
  onSend,
}: {
  onSend?: ((countryCode: string, phone: string, note: string) => void) | undefined;
}) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [countryCode, setCountryCode] = useState('+86');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');

  const handleSend = useCallback(() => {
    onSend?.(countryCode, phone, note);
  }, [countryCode, phone, note, onSend]);

  const phoneInputId = React.useId();
  const noteInputId = React.useId();

  return (
    <form
      className={styles.phonePanel}
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
    >
      <label className={styles.phoneLabel} htmlFor={phoneInputId}>{t('addContact.phone')}</label>
      <div className={styles.phoneRow}>
        <Select
          ariaLabel="区号"
          className={styles.phoneSelect ?? ''}
          value={countryCode}
          options={['+86', '+852', '+1'].map((code) => [code, code])}
          onChange={setCountryCode}
        />
        <input
          id={phoneInputId}
          className={styles.phoneInput}
          placeholder={t('addContact.phonePlaceholder')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <label className={styles.phoneLabel} htmlFor={noteInputId}>{t('addContact.remark')}</label>
      <input
        id={noteInputId}
        className={styles.phoneInput}
        placeholder="例如：合作方 PM / 新同事"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="button" className={styles.phoneSendBtn} onClick={handleSend}>
        {t('addContact.sendInvite')}
      </button>
    </form>
  );
}

// ── Add Contact Modal ──

export function AddContactModal({
  onClose,
  onCopyInvite,
  onSendPhoneInvite,
}: {
  onClose?: (() => void) | undefined;
  onCopyInvite?: (() => void) | undefined;
  onSendPhoneInvite?: ((countryCode: string, phone: string, note: string) => void) | undefined;
}) {
  const [activeTab, setActiveTab] = useState<ContactModalTab>('qr');
  const modalRef = useRef<HTMLElement | null>(null);
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  useFocusTrap(modalRef, true);

  // Move initial focus to the first input of the active panel (close button
  // when the panel has none, e.g. the QR tab).
  useEffect(() => {
    const firstInput = modalRef.current?.querySelector('input');
    const firstFocusable =
      firstInput ?? modalRef.current?.querySelector<HTMLElement>('button');
    firstFocusable?.focus();
  }, []);

  const handleDialogKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.();
    },
    [onClose],
  );

  const handleTablistKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const tabIndex = MODAL_TABS.findIndex((tab) => tab.id === activeTab);
      let nextIndex: number | null = null;
      switch (event.key) {
        case 'ArrowRight':
          nextIndex = (tabIndex + 1) % MODAL_TABS.length;
          break;
        case 'ArrowLeft':
          nextIndex = (tabIndex - 1 + MODAL_TABS.length) % MODAL_TABS.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = MODAL_TABS.length - 1;
          break;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      const nextTab = MODAL_TABS[nextIndex]!;
      setActiveTab(nextTab.id);
      const tabButtons = modalRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabButtons?.[nextIndex]?.focus();
    },
    [activeTab],
  );

  const renderPanel = () => {
    switch (activeTab) {
      case 'qr':
        return <QRPanel />;
      case 'link':
        return <LinkPanel onCopy={onCopyInvite} />;
      case 'code':
        return <CodePanel onCopy={onCopyInvite} />;
      case 'phone':
        return <PhonePanel onSend={onSendPhoneInvite} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={styles.modalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <section
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="addContactTitle"
        onKeyDown={handleDialogKeyDown}
      >
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={t("aria.close")}
        >
          <DesignNavIcon name="close" size={18} />
        </button>

        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle} id="addContactTitle">
            {t('addContact.title')}
          </h2>
          <p className={styles.modalDesc}>
            {t('addContact.subtitle')}
          </p>
        </div>

        <div className={styles.modalTabs} role="tablist" onKeyDown={handleTablistKeyDown}>
          {MODAL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={`${styles.modalTab} ${
                activeTab === tab.id ? styles.modalTabActive : ''
              }`}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.modalBody}>{renderPanel()}</div>
      </section>
    </div>
  );
}
