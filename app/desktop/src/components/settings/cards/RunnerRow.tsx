import { Cpu } from 'lucide-react';
import type { RunnerHealthItem } from '@shared/types';
import styles from '../../SettingsPage.module.css';

export default function RunnerRow({ runner }: { runner: RunnerHealthItem }) {
  return (
    <div className={styles.runnerRow}>
      <div className={styles.connectionIcon}>
        <Cpu size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{runner.name}</strong>
        <span>{runner.capabilities?.join(' / ') || runner.id}</span>
      </div>
      <span className={`${styles.statusPill} ${runner.status === 'online' ? styles.statusPillOn : ''}`}>
        {runner.status}
      </span>
    </div>
  );
}
