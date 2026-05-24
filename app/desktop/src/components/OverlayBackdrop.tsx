import styles from './OverlayBackdrop.module.css';

interface OverlayBackdropProps {
  onClick: () => void;
}

export default function OverlayBackdrop({ onClick }: OverlayBackdropProps) {
  return (
    <div
      className={styles.overlay}
      onClick={onClick}
      aria-hidden="true"
    />
  );
}
