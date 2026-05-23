import styles from './BrandingSection.module.css';

export interface BrandingSectionProps {
  /** Page or section name displayed as the main heading */
  title: string;
  /** Supporting text shown below the title */
  subtitle?: string;
  /** Optional gradient direction override for the brand mark. Defaults to blue-cyan. */
  gradient?: string;
  /** Additional class names for the root container */
  className?: string;
}

export function BrandingSection({ title, subtitle, gradient, className }: BrandingSectionProps) {
  const rootClass = [styles.root, className].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      <div
        className={styles.mark}
        style={gradient ? { background: gradient } : undefined}
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
