import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import logoUrl from '@/assets/tokendance-icon-rounded.svg';
import styles from './DesktopChrome.module.css';

type WindowCommand = 'minimize' | 'toggleMaximize' | 'close';

export interface DesktopChromeProps {
  children: ReactNode;
}

export function DesktopChrome({ children }: DesktopChromeProps) {
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
    (await currentWindow.isMaximized()) ? await currentWindow.unmaximize() : await currentWindow.maximize();
  }

  return (
    <div className={styles.host}>
      <div className={`${styles.chrome} window-chrome`}>
        <div className={styles.drag}>
          <span className={styles.brandMark}>
            <img alt="AgentHub" src={logoUrl} />
          </span>
          <span className={styles.title}>AgentHub</span>
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
