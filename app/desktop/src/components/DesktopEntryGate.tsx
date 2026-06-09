import { useState } from 'react';
import { DesignNavIcon } from '@shared/workbench';
import agentHubLogo from '@/assets/agenthub-product-icon-rounded.svg';
import tokenDanceLogo from '@/assets/tokendance-product-mark-transparent.svg';
import styles from './DesktopEntryGate.module.css';

export interface DesktopEntryGateProps {
  onContinueDemo: () => void;
  onToggleTheme: () => void;
  edgeOnline: boolean;
}

export function DesktopEntryGate({ onContinueDemo, onToggleTheme }: DesktopEntryGateProps) {
  const [loginPending, setLoginPending] = useState(false);

  return (
    <main aria-label="Desktop entry" className={styles.entry}>
      <section aria-labelledby="desktop-entry-title" className={styles.card}>
        <button
          aria-label="切换主题"
          className={styles.themeButton}
          onClick={onToggleTheme}
          title="切换主题"
          type="button"
        >
          <DesignNavIcon name="sun" size={16} />
        </button>
        <img alt="AgentHub" className={styles.mark} src={agentHubLogo} />
        <h1 id="desktop-entry-title">登录 AgentHub</h1>
        <div className={styles.actions}>
          <button
            className={styles.primaryButton}
            onClick={() => setLoginPending(true)}
            type="button"
          >
            <img
              alt=""
              aria-hidden="true"
              className={styles.identityLogo}
              data-testid="tokendance-id-logo"
              src={tokenDanceLogo}
            />
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
