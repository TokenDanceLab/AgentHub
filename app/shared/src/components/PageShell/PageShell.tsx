import type { ReactNode } from 'react';
import styles from './PageShell.module.css';

export interface PageShellProps {
  sidebar?: ReactNode;
  children: ReactNode;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function PageShell({
  sidebar,
  children,
  className,
}: PageShellProps) {
  return (
    <div className={cx(styles.root, className)}>
      {sidebar && (
        <aside className={styles.sidebar} aria-label="Page navigation">
          {sidebar}
        </aside>
      )}
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}

export default PageShell;
