import React, { type ButtonHTMLAttributes, forwardRef } from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'gradient' | 'icon';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    const cls = [styles.base, variantClass(variant), sizeClass(size), className]
      .filter(Boolean)
      .join(' ');
    return (
      <button ref={ref} className={cls} {...props}>
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';

export { Button };
