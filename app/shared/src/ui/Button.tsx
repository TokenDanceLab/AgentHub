import React, { type ButtonHTMLAttributes, forwardRef } from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'gradient' | 'icon';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows an inline spinner and blocks interaction (aria-busy). */
  loading?: boolean;
}

function variantClass(v: ButtonVariant): string {
  switch (v) {
    case 'primary': return styles.primary!;
    case 'secondary': return styles.secondary!;
    case 'ghost': return styles.ghost!;
    case 'destructive': return styles.destructive!;
    case 'gradient': return styles.gradient!;
    case 'icon': return styles.icon!;
  }
}

function sizeClass(s: ButtonSize): string {
  switch (s) {
    case 'sm': return styles.sm!;
    case 'md': return styles.md!;
    case 'lg': return styles.lg!;
  }
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', fullWidth, loading, disabled, children, ...props }, ref) => {
    const cls = [
      styles.base,
      variantClass(variant),
      sizeClass(size),
      fullWidth && styles.fullWidth,
      loading && styles.loading,
      className,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <button
        type="button"
        ref={ref}
        className={cls}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';

export { Button };
