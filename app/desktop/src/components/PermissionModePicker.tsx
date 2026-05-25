import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Hand, ShieldCheck, ShieldAlert, Settings } from 'lucide-react';
import styles from './PermissionModePicker.module.css';

export interface PermissionModeOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  label: string;
  options: PermissionModeOption[];
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (value: string) => void;
}

function optionIcon(value: string) {
  if (value === 'acceptEdits') return <ShieldCheck size={16} />;
  if (value === 'bypassPermissions' || value === 'dontAsk') return <ShieldAlert size={16} />;
  if (value === 'plan') return <Hand size={16} />;
  return <Settings size={16} />;
}

export default function PermissionModePicker({ value, label, options, disabled, ariaLabel, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  const popover = open && createPortal(
    <div
      ref={popoverRef}
      className={`${styles.popover} ${pos.up ? styles.popoverUp : ''}`}
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
          className={`${styles.option} ${option.value === value ? styles.optionActive : ''}`}
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
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => open ? setOpen(false) : openPicker()}
      >
        <ShieldCheck size={14} />
        <span>{label}</span>
      </button>
      {popover}
    </div>
  );
}
