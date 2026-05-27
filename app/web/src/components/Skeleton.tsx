import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function SkeletonLine({ width = '100%', height = '1em', className }: SkeletonProps) {
  return (
    <div
      className={`${styles.base} ${styles.line}${className ? ` ${className}` : ''}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonBlock({ width = '100%', height = '100px', className }: SkeletonProps) {
  return (
    <div
      className={`${styles.base} ${styles.block}${className ? ` ${className}` : ''}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonCircle({ width = 32, height = 32, className }: SkeletonProps) {
  return (
    <div
      className={`${styles.base} ${styles.circle}${className ? ` ${className}` : ''}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
