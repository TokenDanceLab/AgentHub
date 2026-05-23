// Branch navigation — "← 2/5 →" for sibling responses
// 参考: LibreChat SiblingSwitch.tsx (69 lines)
import styles from './SiblingSwitch.module.css';

interface Props {
  siblingIdx: number;
  siblingCount: number;
  onPrev: () => void;
  onNext: () => void;
}

export default function SiblingSwitch({ siblingIdx, siblingCount, onPrev, onNext }: Props) {
  if (siblingCount <= 1) return null;

  const isFirst = siblingIdx === 0;
  const isLast = siblingIdx === siblingCount - 1;

  return (
    <div
      className={styles.root}
      role="navigation"
      aria-label="Branch navigation"
      aria-live="polite"
    >
      <button
        className={`${styles.btn} ${isFirst ? styles.btnDisabled : ''}`}
        onClick={onPrev}
        disabled={isFirst}
        aria-label="Previous response"
      >
        ←
      </button>
      <span className={styles.label}>
        {siblingIdx + 1} / {siblingCount}
      </span>
      <button
        className={`${styles.btn} ${isLast ? styles.btnDisabled : ''}`}
        onClick={onNext}
        disabled={isLast}
        aria-label="Next response"
      >
        →
      </button>
    </div>
  );
}
