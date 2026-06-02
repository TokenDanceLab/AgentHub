import { type ReactNode } from 'react';
import { Check } from 'lucide-react';
import styles from '../../SettingsPage.module.css';

interface ModeCardProps {
  active: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

export default function ModeCard({ active, icon, title, description, onClick }: ModeCardProps) {
  return (
    <button className={`${styles.modeCard} ${active ? styles.modeCardActive : ''}`} onClick={onClick}>
      {icon}
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {active ? <Check size={16} className={styles.modeCheck} /> : null}
    </button>
  );
}
