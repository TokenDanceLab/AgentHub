import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Hand, ShieldCheck, ShieldAlert, Settings } from 'lucide-react';
import styles from './PermissionModePicker.module.css';

export interface PermissionModeOption {
  value: string;
  label: string;
}

export interface PermissionModePickerProps {
  value: string;
  label: string;
  options: PermissionModeOption[];
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (value: string) => void;
  /** Additional class names for customization */
  className?: string;
  triggerClassName?: string;
  popoverClassName?: string;
  optionClassName?: string;
  activeOptionClassName?: string;
}

function optionIcon(value: string, size = 16) {
  if (value === 'acceptEdits') return <ShieldCheck size={size} />;
  if (value === 'bypassPermissions' || value === 'dontAsk') return <ShieldAlert size={size} />;
  if (value === 'plan') return <Hand size={size} />;
  return <Settings size={size} />;
}

export function PermissionModePicker({
  value,
  label,
  options,
  disabled,
  ariaLabel,
  onChange,
  className,
  triggerClassName,
  popoverClassName,
  optionClassName,
  activeOptionClassName,
}: PermissionModePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const [focusIdx, setFocusIdx] = useState(0);
  const wasOpenRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const focusOption = useCallback((idx: number) => {
    const option = popoverRef.current?.querySelectorAll<HTMLButtonElement>('button')[idx];
    option?.focus();
  }, []);

  // Move focus into the popover (first option) when it opens, and restore
  // focus to the trigger when it closes.
  useEffect(() => {
    if (open) {
      setFocusIdx(0);
      focusOption(0);
    } else if (wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, focusOption]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const width = 270;
    const height = 230;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const up = spaceBelow < height && spaceAbove > spaceBelow;
    setPos({
      top: up ? rect.top - 6 : rect.bottom + 6,
      left: Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin),
      width,
      up,
    });
  }, []);

  const openPicker = useCallback(() => {
    if (disabled) return;
    updatePosition();
    setOpen(true);
  }, [disabled, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleLayout = () => updatePosition();
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleLayout, true);
    window.addEventListener('resize', handleLayout);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleLayout, true);
      window.removeEventListener('resize', handleLayout);
    };
  }, [open, updatePosition]);

  const cx = (...classes: Array<string | false | null | undefined>): string =>
    classes.filter(Boolean).join(' ');

  const handlePopoverKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setFocusIdx((i) => {
            const next = (i + 1) % options.length;
            focusOption(next);
            return next;
          });
          break;
        case 'ArrowUp':
          event.preventDefault();
          setFocusIdx((i) => {
            const next = (i - 1 + options.length) % options.length;
            focusOption(next);
            return next;
          });
          break;
        case 'Home':
          event.preventDefault();
          setFocusIdx(0);
          focusOption(0);
          break;
        case 'End':
          event.preventDefault();
          setFocusIdx(options.length - 1);
          focusOption(options.length - 1);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (options[focusIdx]) {
            onChange(options[focusIdx].value);
            setOpen(false);
          }
          break;
      }
    },
    [focusIdx, options, onChange, focusOption],
  );

  const popover = open && createPortal(
    <div
      ref={popoverRef}
      role="menu"
      aria-label={ariaLabel ?? label}
      className={cx(styles.popover, pos.up ? styles.popoverUp : undefined, popoverClassName)}
      onKeyDown={handlePopoverKeyDown}
      style={{
        position: 'fixed',
        zIndex: 9999,
        top: pos.up ? 'auto' : pos.top,
        bottom: pos.up ? `${window.innerHeight - pos.top}px` : 'auto',
        left: pos.left,
        width: pos.width,
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={option.value === value}
          tabIndex={-1}
          className={cx(
            styles.option,
            optionClassName,
            option.value === value && styles.optionActive,
            option.value === value && activeOptionClassName,
          )}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
        >
          <span className={styles.optionIcon}>{optionIcon(option.value)}</span>
          <span className={styles.optionLabel}>{option.label}</span>
          {option.value === value && <Check size={16} className={styles.check} />}
        </button>
      ))}
    </div>,
    document.body,
  );

  return (
    <div className={cx(styles.root, className)}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(styles.trigger, triggerClassName)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => open ? setOpen(false) : openPicker()}
      >
        {optionIcon(value, 14)}
        <span>{label}</span>
      </button>
      {popover}
    </div>
  );
}
