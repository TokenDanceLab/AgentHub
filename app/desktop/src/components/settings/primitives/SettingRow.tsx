import { type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import styles from '../../SettingsPage.module.css';

interface SettingRowProps {
  title: string;
  description: string;
  value?: string;
  control?: ReactNode;
  action?: boolean;
}

export default function SettingRow({ title, description, value, control, action }: SettingRowProps) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingCopy}>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {control ?? (value ? <span className={styles.settingValue}>{value}</span> : null)}
      {action ? <ChevronRight size={17} className={styles.rowChevron} /> : null}
    </div>
  );
}
