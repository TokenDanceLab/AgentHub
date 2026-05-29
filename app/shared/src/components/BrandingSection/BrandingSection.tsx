import React from 'react';
import styles from './BrandingSection.module.css';

export interface BrandingSectionProps {
  /** Page or section name displayed as the main heading */
  title: string;
  /** Supporting text shown below the title */
  subtitle?: string;
  /** Optional solid color override for the brand mark. */
  accent?: string;
  /** Additional class names for the root container */
  className?: string;
}

export function BrandingSection({ title, subtitle, accent, className }: BrandingSectionProps) {
  const rootClass = [styles.root, className].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      <div
        className={styles.mark}
        style={accent ? { backgroundColor: accent } : undefined}
        aria-hidden="true"
      >
        AH
      </div>
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
    </div>
  );
}

export default BrandingSection;
