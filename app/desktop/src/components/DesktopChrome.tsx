import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
          <div aria-label="Desktop navigation controls" className={styles.toolbar} role="group">
            <button
              aria-label="切换左侧栏"
              className={`${styles.chromeButton} ${styles.sidebarButton}`}
              onClick={() => dispatchDesktopEvent(DESKTOP_TOGGLE_SIDEBAR_EVENT)}
              title="收起 / 展开左侧栏"
              type="button"
            >
              <DesignNavIcon name="sidebarLeft" size={15} strokeWidth={1.85} />
            </button>
            <div className={styles.historyGroup}>
              <button
                aria-label="后退"
                className={styles.chromeButton}
                onClick={() => runNavigationCommand('back')}
                title="上一页"
                type="button"
              >
                <DesignNavIcon name="back" size={15} strokeWidth={1.85} />
              </button>
              <button
                aria-label="前进"
                className={styles.chromeButton}
                onClick={() => runNavigationCommand('forward')}
                title="下一页"
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
        <div aria-label="Window controls" className={styles.controls} role="group">
          <button
            aria-label="最小化"
            className={styles.windowButton}
            onClick={() => void runWindowCommand('minimize')}
            title="最小化"
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            aria-label="最大化"
            className={styles.windowButton}
            onClick={() => void runWindowCommand('toggleMaximize')}
            title="最大化"
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <rect height="12" rx="1.5" width="12" x="6" y="6" />
            </svg>
          </button>
          <button
            aria-label="关闭"
            className={`${styles.windowButton} ${styles.windowButtonClose}`}
            onClick={() => void runWindowCommand('close')}
            title="关闭"
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
