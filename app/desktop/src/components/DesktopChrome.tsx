import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { DesignNavIcon } from '@agenthub/workbench/designIcons';
import {
  DESKTOP_NAVIGATE_BACK_EVENT,
  DESKTOP_NAVIGATE_FORWARD_EVENT,
  DESKTOP_TOGGLE_SIDEBAR_EVENT,
} from '@agenthub/workbench/desktopChromeEvents';
import styles from './DesktopChrome.module.css';

type WindowCommand = 'minimize' | 'toggleMaximize' | 'close';

export interface DesktopChromeProps {
  children: ReactNode;
  showNavigationControls?: boolean | undefined;
}

export function DesktopChrome({ children, showNavigationControls = true }: DesktopChromeProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);

  function dispatchDesktopEvent(eventName: string): void {
    window.dispatchEvent(new Event(eventName));
  }

  function runNavigationCommand(direction: 'back' | 'forward'): void {
    if (direction === 'back') {
      dispatchDesktopEvent(DESKTOP_NAVIGATE_BACK_EVENT);
      window.history.back();
      return;
    }
    dispatchDesktopEvent(DESKTOP_NAVIGATE_FORWARD_EVENT);
    window.history.forward();
  }

  async function runWindowCommand(command: WindowCommand): Promise<void> {
    if (!isTauriRuntime()) return;

    const currentWindow = getCurrentWindow();
    if (command === 'minimize') {
      await currentWindow.minimize();
      return;
    }
    if (command === 'close') {
      await currentWindow.close();
      return;
    }
    if (await currentWindow.isMaximized()) {
      await currentWindow.unmaximize();
    } else {
      await currentWindow.maximize();
    }
  }

  return (
    <div className={styles.host}>
      <div className={`${styles.chrome} window-chrome`} data-desktop-window-chrome>
        {showNavigationControls ? (
          <div aria-label={t('aria.navControls')} className={styles.toolbar} role="group">
            <button
              aria-label={t('aria.toggleSidebar')}
              className={`${styles.chromeButton} ${styles.sidebarButton}`}
              onClick={() => dispatchDesktopEvent(DESKTOP_TOGGLE_SIDEBAR_EVENT)}
              title={t('aria.toggleSidebar')}
              type="button"
            >
              <DesignNavIcon name="sidebarLeft" size={15} strokeWidth={1.85} />
            </button>
            <div className={styles.historyGroup}>
              <button
                aria-label={t('aria.goBack')}
                className={styles.chromeButton}
                onClick={() => runNavigationCommand('back')}
                title={t('aria.goBack')}
                type="button"
              >
                <DesignNavIcon name="back" size={15} strokeWidth={1.85} />
              </button>
              <button
                aria-label={t('aria.goForward')}
                className={styles.chromeButton}
                onClick={() => runNavigationCommand('forward')}
                title={t('aria.goForward')}
                type="button"
              >
                <DesignNavIcon name="forward" size={15} strokeWidth={1.85} />
              </button>
            </div>
          </div>
        ) : null}
        <div className={styles.drag}>
          <span className={styles.dragHandle} aria-hidden="true" />
        </div>
        <div aria-label={t('aria.windowControls')} className={styles.controls} role="group">
          <button
            aria-label={t('aria.minimize')}
            className={styles.windowButton}
            onClick={() => void runWindowCommand('minimize')}
            title={t('aria.minimize')}
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            aria-label={t('aria.maximize')}
            className={styles.windowButton}
            onClick={() => void runWindowCommand('toggleMaximize')}
            title={t('aria.maximize')}
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <rect height="12" rx="1.5" width="12" x="6" y="6" />
            </svg>
          </button>
          <button
            aria-label={t('aria.close')}
            className={`${styles.windowButton} ${styles.windowButtonClose}`}
            onClick={() => void runWindowCommand('close')}
            title={t('aria.close')}
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
