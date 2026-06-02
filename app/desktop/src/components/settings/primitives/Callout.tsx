import { ShieldCheck } from 'lucide-react';
import styles from '../../SettingsPage.module.css';

interface CalloutProps {
  title: string;
  body: string;
}

export default function Callout({ title, body }: CalloutProps) {
  return (
    <div className={styles.callout}>
      <ShieldCheck size={18} />
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </div>
  );
}
