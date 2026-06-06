import React from 'react';
import styles from './AgentHubWorkbench.module.css';

export function GlobalRail(): React.ReactElement {
  return (
    <nav aria-label="Global rail" className={styles.rail}>
      <span aria-hidden="true" className={styles.mark}>AH</span>
      <button aria-current="page" aria-label="对话" className={styles.railButton} type="button">
        对话
      </button>
      <button aria-label="Agent" className={styles.railButton} type="button">
        Agent
      </button>
      <button aria-label="任务" className={styles.railButton} type="button">
        任务
      </button>
    </nav>
  );
}
