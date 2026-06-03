import { Link2 } from 'lucide-react';
import styles from './primitives.module.css';

interface ConnectionRowProps {
  name: string;
  description: string;
  connected: boolean;
  onlineLabel: string;
  offlineLabel: string;
}

export default function ConnectionRow({ name, description, connected, onlineLabel, offlineLabel }: ConnectionRowProps) {
  return (
    <div className={styles.connectionRow}>
      <div className={styles.connectionIcon}>
        <Link2 size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{name}</strong>
        <span>{description}</span>
      </div>
      <span className={`${styles.statusPill} ${connected ? styles.statusPillOn : ''}`}>
        {connected ? onlineLabel : offlineLabel}
      </span>
    </div>
  );
}
