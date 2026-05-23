import styles from './PreviewBanner.module.css';

export default function PreviewBanner() {
  return (
    <div className={styles.banner} role="alert" aria-label="Preview mode notice">
      <span className={styles.icon} aria-hidden="true">&#9888;</span>
      <span className={styles.text}>
        <strong>Preview Mode</strong> &mdash; UI prototype, not production-ready
      </span>
    </div>
  );
}
