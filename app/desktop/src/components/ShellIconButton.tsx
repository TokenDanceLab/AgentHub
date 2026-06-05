import {
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from '@/App.module.css';

type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

export interface ShellIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  ariaLabel?: string;
  tooltipSide?: TooltipSide;
  children: ReactNode;
}

export default function ShellIconButton({
  label,
  ariaLabel,
  tooltipSide = 'bottom',
  className,
  children,
  type = 'button',
  ...buttonProps
}: ShellIconButtonProps) {
  const tooltipId = useId();
  return (
    <button
      {...buttonProps}
      type={type}
      className={`${className ?? ''} ${styles.iconTooltipHost}`}
      aria-label={ariaLabel ?? label}
      aria-describedby={tooltipId}
      data-tooltip-side={tooltipSide}
    >
      <span className={styles.iconTooltipGlyph} aria-hidden="true">{children}</span>
      <span id={tooltipId} role="tooltip" className={styles.iconTooltip}>{label}</span>
    </button>
  );
}
