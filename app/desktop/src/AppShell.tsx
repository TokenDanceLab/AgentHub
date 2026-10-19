import { useEffect, useRef } from 'react';
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

/**
 * Checks GitHub Releases for a newer build once per launch and offers to
 * install it. Failures are ignored: the updater must never block startup.
 */
function UpdateChecker() {
  const { t } = useTranslation();
  const tRef = useRef(t);

  // Keep the latest translator available to the mount-only check. Syncing in
  // an effect (declared first, so it runs before the check below) avoids
  // writing a ref during render.
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Mount-only: a language change replaces `t` and must not re-check. The
  // empty dependency list also keeps React StrictMode's simulated remount
  // working — its first result is cancelled, the second prompts once.
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const version = await invoke<string | null>('check_for_update');
        if (!version || cancelled) return;
        const { ask } = await import('@tauri-apps/plugin-dialog');
        const tr = tRef.current;
        const accepted = await ask(tr('updater.available', { version }), {
          title: tr('updater.title'),
          kind: 'info',
          okLabel: tr('updater.install'),
          cancelLabel: tr('updater.later'),
        });
        if (accepted && !cancelled) {
          await invoke('install_update');
        }
      } catch {
        // Offline, unsigned local builds, and browser previews all land here.
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

export function AppShell() {
  return (
    <>
      <TrayLabelSyncer />
      <UpdateChecker />
      <App />
    </>
  );
}
