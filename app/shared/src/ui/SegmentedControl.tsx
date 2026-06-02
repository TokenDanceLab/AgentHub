import React, { type ReactNode } from 'react';
import styles from './SegmentedControl.module.css';

export interface SegmentedControlOption<TValue extends string = string> {
  value: TValue;
  label: string;
  icon?: ReactNode;
  meta?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<TValue extends string = string> {
  options: Array<SegmentedControlOption<TValue>>;
  value: TValue;
  onChange: (value: TValue) => void;
  ariaLabel: string;
  as?: 'div' | 'nav';
  className?: string;
  optionClassName?: string;
  activeOptionClassName?: string;
  labelClassName?: string;
  metaClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function SegmentedControl<TValue extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  as = 'div',
  className,
  optionClassName,
  activeOptionClassName,
  labelClassName,
  metaClassName,
}: SegmentedControlProps<TValue>) {
  const Root = as;

  return (
    <Root className={cx(styles.root, className)} aria-label={ariaLabel}>
      {options.map((option) => {
        const isActive = option.value === value;
        const readableMeta = typeof option.meta === 'string' || typeof option.meta === 'number'
          ? option.meta
          : undefined;
        const ariaName = option.ariaLabel ?? (readableMeta !== undefined ? `${option.label} ${readableMeta}` : undefined);
        return (
          <button
            key={option.value}
            className={cx(
              styles.option,
              optionClassName,
              isActive && styles.optionActive,
              isActive && activeOptionClassName,
            )}
            type="button"
            aria-label={ariaName}
            aria-pressed={isActive}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <span className={styles.icon}>{option.icon}</span> : null}
            <span className={cx(styles.label, labelClassName)}>{option.label}</span>
            {option.meta !== undefined && option.meta !== null ? (
              <strong className={cx(styles.meta, metaClassName)}>{option.meta}</strong>
            ) : null}
          </button>
        );
      })}
    </Root>
  );
}
