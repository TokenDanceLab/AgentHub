import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import App from '@/App';
import i18n from '@/i18n';

/**
 * Syncs tray menu labels with the current i18n language.
 * Runs once on mount and again whenever the user switches language.
 * Silently ignores failures (e.g. running in a browser preview without a tray).
 */
function TrayLabelSyncer() {
  const { t } = useTranslation();

  useEffect(() => {
    const sync = () => {
      invoke('set_tray_labels', {
        labels: {
          show: t('tray.showWindow'),
          hide: t('tray.hideWindow'),
          start_edge: t('tray.startEdge'),
          stop_edge: t('tray.stopEdge'),
          quit: t('tray.quit'),
          tooltip: t('tray.tooltip'),
        },
      }).catch(() => {
        // Tray icon does not exist in browser previews — ignore silently.
      });
    };

    sync();
    i18n.on('languageChanged', sync);
    return () => {
      i18n.off('languageChanged', sync);
    };
  }, [t]);

  return null;
}

export function AppShell() {
  return (
    <>
      <TrayLabelSyncer />
      <App />
    </>
  );
}
