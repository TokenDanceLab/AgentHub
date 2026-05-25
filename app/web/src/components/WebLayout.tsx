import type { ReactNode } from 'react';
import { Avatar } from '@shared/ui';
import { Icon } from '@shared/ui';
import styles from './WebLayout.module.css';

interface NavItem {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
  href?: string;
}

interface SectionLabel {
  text: string;
  count?: number;
}

interface WebLayoutProps {
  /** Brand name shown in sidebar */
  brandName?: string;
  /** Subtitle shown under brand (e.g. 'Workbench') */
  brandSubtitle?: string;
  /** Navigation items in sidebar */
  navItems?: NavItem[];
  /** Optional section labels with counts */
  sectionLabels?: SectionLabel[];
  /** Optional bottom slot in sidebar (e.g. sessions list) */
  sidebarBottom?: ReactNode;
  /** Optional action button at top of sidebar */
  sidebarAction?: ReactNode;
  /** Topbar content (left side and right side) */
  topbarLeft?: ReactNode;
  topbarRight?: ReactNode;
  /** Main content area */
  children: ReactNode;
  /** Optional right drawer panel */
  drawer?: ReactNode;
}

export function WebLayout({
  brandName = 'AGENTHUB',
  brandSubtitle,
  navItems,
  sectionLabels,
  sidebarBottom,
  sidebarAction,
  topbarLeft,
  topbarRight,
  children,
  drawer,
}: WebLayoutProps) {
  return (
    <div className={styles.root}>
      <aside className={`${styles.sidebar} ${styles.glass}`} aria-label="Navigation">
        <div className={styles.brand}>
          <Avatar initials="AH" size="lg" variant="brand" />
          <div className={styles.brandTitle}>
            <h2 className={styles.brandName}>{brandName}</h2>
            {brandSubtitle ? (
              <p className={styles.brandSubtitle}>{brandSubtitle}</p>
            ) : null}
          </div>
        </div>

        {sidebarAction ? (
          <div style={{ marginTop: 14 }}>{sidebarAction}</div>
        ) : null}

        {navItems && navItems.length > 0 ? (
          <nav className={styles.nav} aria-label="Primary">
            {navItems.map((item) => {
              const cls = [
                styles.navItem,
                item.active ? styles.navItemActive : '',
              ].filter(Boolean).join(' ');

              const iconEl = <Icon name={item.icon} size={20} />;

              if (item.href) {
                return (
                  <a key={item.label} href={item.href} className={cls}>
                    {iconEl}
                    {item.label}
                  </a>
                );
              }

              return (
                <button key={item.label} type="button" className={cls} onClick={item.onClick}>
                  {iconEl}
                  {item.label}
                </button>
              );
            })}
          </nav>
        ) : null}

        {sectionLabels?.map((section) => (
          <div className={styles.sectionLabel} key={section.text}>
            <span>{section.text}</span>
            {section.count !== undefined ? <span>{section.count}</span> : null}
          </div>
        ))}

        {sidebarBottom ? (
          <div style={{ marginTop: 'auto' }}>{sidebarBottom}</div>
        ) : null}
      </aside>

      <section className={styles.main}>
        <header className={`${styles.topbar} ${styles.glass}`}>
          <div className={styles.topbarLeft}>{topbarLeft}</div>
          <div className={styles.topbarRight}>{topbarRight}</div>
        </header>

        <div className={styles.content}>
          {drawer ? (
            <div className={styles.workGrid}>
              {children}
              <aside className={`${styles.drawer} ${styles.glass}`} aria-label="Panel">
                {drawer}
              </aside>
            </div>
          ) : (
            children
          )}
        </div>
      </section>
    </div>
  );
}
