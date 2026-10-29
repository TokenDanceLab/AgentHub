import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '@shared/ui/Modal';
import { Button } from '@shared/ui';
import styles from './LogoutDialog.module.css';

export function LogoutDialog({ open, onClose, onLogout, onLogoutAccount }: {
  open: boolean;
  onClose(): void;
  onLogout(): Promise<void>;
  onLogoutAccount(): Promise<void>;
}) {
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try { await action(); onClose(); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={t('browserSession.logoutTitle')} contentClassName={styles.content}>
    <div className={styles.body}>
    <p>{t('browserSession.logoutDescription')}</p>
    {failed && <p role="alert">{t('browserSession.logoutFailed')}</p>}
    <div className={styles.actions}>
      <Button disabled={busy} onClick={() => { void run(onLogout); }}>{t('browserSession.logoutLocal')}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => { void run(onLogoutAccount); }}>{t('browserSession.logoutAccount')}</Button>
    </div>
    </div>
  </Modal>;
}
