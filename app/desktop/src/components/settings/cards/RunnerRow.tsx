import { RuntimeBrandIcon } from '@shared/workbench';
import type { RunnerHealthItem } from '@shared/types';
import styles from '../primitives/primitives.module.css';

export default function RunnerRow({ runner }: { runner: RunnerHealthItem }) {
  return (
    <div className={styles.runnerRow}>
      <div className={styles.connectionIcon}>
        <RuntimeBrandIcon kind="runtime" name={runner.id || runner.name} size="compact" framed={false} />
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
