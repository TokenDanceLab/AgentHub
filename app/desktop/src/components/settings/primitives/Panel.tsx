import { type ReactNode } from 'react';
import styles from '../../SettingsPage.module.css';

interface PanelProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export default function Panel({ title, description, children }: PanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
