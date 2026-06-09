import { useState } from 'react';
import tokenDanceLogo from '@/assets/tokendance-product-icon-rounded.svg';
import styles from './DesktopEntryGate.module.css';

export interface DesktopEntryGateProps {
  onContinueDemo: () => void;
  edgeOnline: boolean;
}

export function DesktopEntryGate({ onContinueDemo }: DesktopEntryGateProps) {
  const [loginPending, setLoginPending] = useState(false);

  return (
    <main aria-label="Desktop entry" className={styles.entry}>
      <section aria-labelledby="desktop-entry-title" className={styles.card}>
        <div className={styles.mark} aria-hidden="true">A</div>
        <h1 id="desktop-entry-title">登录 AgentHub</h1>
        <div className={styles.actions}>
          <button
            className={styles.primaryButton}
            onClick={() => setLoginPending(true)}
            type="button"
          >
            <img alt="TokenDance" className={styles.identityLogo} src={tokenDanceLogo} />
            <span>使用 TokenDance ID 继续</span>
          </button>
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
      </section>
    </main>
  );
}
