import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, Download, CheckCircle, AlertCircle, Info } from 'lucide-react';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import styles from '../primitives/primitives.module.css';

interface UpdateInfo {
  has_update: boolean;
  version: string | null;
  current_version: string | null;
  error: string | null;
}

type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error' | 'installing';

const APP_VERSION = 'v0.2.0';

export default function AboutSection() {
  const { t } = useTranslation();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateMessage, setUpdateMessage] = useState('');
  const [latestVersion, setLatestVersion] = useState('');

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    setUpdateMessage('');
    setLatestVersion('');
    try {
      const result = await invoke<UpdateInfo>('check_for_update');
      if (result.error) {
        setUpdateStatus('error');
        setUpdateMessage(result.error);
      } else if (result.has_update && result.version) {
        setLatestVersion(result.version);
        setUpdateStatus('available');
        setUpdateMessage(t('settings.about.updateAvailable', { version: result.version }));
      } else {
        setUpdateStatus('up-to-date');
        setUpdateMessage(t('settings.about.upToDate'));
      }
    } catch (err) {
      setUpdateStatus('error');
      setUpdateMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateStatus('installing');
    try {
      await invoke('install_update');
      setUpdateStatus('up-to-date');
      setUpdateMessage(t('settings.about.installComplete'));
    } catch (err) {
      setUpdateStatus('error');
      setUpdateMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const isBusy = updateStatus === 'checking' || updateStatus === 'installing';

  return (
    <Panel title={t('settings.about')} description={t('settings.about.desc')}>
      <SettingRow
        title={t('settings.about.version')}
        description={t('settings.about.versionDesc')}
        control={<span style={{ color: 'var(--text-secondary)' }}>{APP_VERSION}</span>}
      />
      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <strong>{t('settings.about.updates')}</strong>
          <span>{t('settings.about.updatesDesc')}</span>
        </div>
        <button
          className={styles.secondaryBtn}
          onClick={handleCheckUpdate}
          disabled={isBusy}
        >
          {updateStatus === 'checking' ? (
            <>
              <RefreshCw size={14} className={styles.spinIcon} />
              {t('settings.about.checking')}
            </>
          ) : (
            <>
              <RefreshCw size={14} />
              {t('settings.about.checkForUpdates')}
            </>
          )}
        </button>
      </div>

      {updateStatus === 'up-to-date' && (
        <div className={styles.callout}>
          <CheckCircle size={18} />
          <div>
            <strong>{t('settings.about.upToDateTitle')}</strong>
            <span>{updateMessage}</span>
          </div>
        </div>
      )}

      {updateStatus === 'available' && (
        <div className={styles.callout}>
          <Info size={18} />
          <div>
            <strong>{t('settings.about.newVersionTitle')}</strong>
            <span>
              {latestVersion
                ? t('settings.about.newVersionAvailable', { version: latestVersion })
                : updateMessage}
            </span>
            <button
              className={styles.primaryBtn}
              onClick={handleInstallUpdate}
              disabled={isBusy}
              style={{ marginTop: 10, alignSelf: 'flex-start' }}
            >
              {updateStatus === 'installing' ? (
                <>
                  <RefreshCw size={14} className={styles.spinIcon} />
                  {t('settings.about.installing')}
                </>
              ) : (
                <>
                  <Download size={14} />
                  {t('settings.about.downloadAndInstall')}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {updateStatus === 'error' && (
        <div className={styles.callout}>
          <AlertCircle size={18} />
          <div>
            <strong>{t('settings.about.updateError')}</strong>
            <span>{updateMessage}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
