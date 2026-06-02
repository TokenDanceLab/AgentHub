import { UserCircle } from 'lucide-react';
import styles from '../../SettingsPage.module.css';

interface AuthGapBlockProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

export default function AuthGapBlock({ title, description, actionLabel, onAction }: AuthGapBlockProps) {
  return (
    <div className={styles.authGapBlock}>
      <div className={styles.settingCopy}>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <button type="button" className={styles.primaryBtn} onClick={onAction}>
        <UserCircle size={16} />
        {actionLabel}
      </button>
    </div>
  );
}
