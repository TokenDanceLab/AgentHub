import { useState } from 'react';
import styles from './DesktopEntryGate.module.css';

export interface DesktopEntryGateProps {
  onContinueDemo: () => void;
  onConnectEdge: () => void;
  edgeOnline: boolean;
}

export function DesktopEntryGate({ onContinueDemo, onConnectEdge, edgeOnline }: DesktopEntryGateProps) {
  const [loginPending, setLoginPending] = useState(false);

  return (
    <main aria-label="Desktop entry" className={styles.entry}>
      <section aria-labelledby="desktop-entry-title" className={styles.card}>
        <div className={styles.mark} aria-hidden="true">
          <svg viewBox="0 0 160 160">
            <rect width="160" height="160" rx="32" ry="32" />
            <rect x="39" y="20" width="20" height="80" rx="10" ry="10" />
            <rect x="70" y="40" width="20" height="80" rx="10" ry="10" />
            <rect x="101" y="60" width="20" height="80" rx="10" ry="10" />
          </svg>
        </div>
        <h1 id="desktop-entry-title">登录 TokenDance</h1>
        <div className={styles.actions}>
          {edgeOnline ? (
            <button
              className={styles.primaryButton}
              onClick={onConnectEdge}
              type="button"
            >
              连接 Local Edge
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              onClick={() => setLoginPending(true)}
              type="button"
            >
              使用 TokenDance ID 继续
            </button>
          )}
          <button
            className={styles.secondaryButton}
            onClick={onContinueDemo}
            type="button"
          >
            使用 Demo 模式继续
          </button>
        </div>
        {loginPending ? (
          <p className={styles.status} role="status">TokenDance ID 登录链路待接入</p>
        ) : null}
        {edgeOnline ? (
          <p className={styles.status} role="status">检测到 Local Edge 在线，可直接读取数据</p>
        ) : null}
      </section>
    </main>
  );
}
