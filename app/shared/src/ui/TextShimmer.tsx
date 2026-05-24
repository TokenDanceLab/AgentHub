import { useEffect, useState } from 'react';
import styles from './TextShimmer.module.css';

interface TextShimmerProps {
  /** Number of shimmer bars to display */
  bars?: number;
  /** Text label shown alongside shimmer */
  label?: string;
}

/** Animated text placeholder for streaming/loading states.
 *  Pattern from OpenCode's TextShimmer component. */
export function TextShimmer({ bars = 3, label }: TextShimmerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`${styles.shimmer} ${visible ? styles.visible : ''}`} aria-busy="true">
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.bars}>
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className={styles.bar}
            style={{ width: `${60 + Math.random() * 35}%`, animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
