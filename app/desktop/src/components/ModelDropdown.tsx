// Custom model/agent dropdown — Portal-rendered popover with glass blur.
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { ModelIcon } from '@lobehub/icons';
import styles from './ModelDropdown.module.css';

interface Option {
  value: string;
  label: string;
  group?: string;
}

interface Props {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

function cleanModelName(name: string): string {
  const map: Record<string, string> = {
    'claude-opus-4-7': 'Claude 4.7 Opus',
    'claude-opus-4-5': 'Claude 4.5 Opus',
    'claude-sonnet-4-6': 'Claude 4.6 Sonnet',
    'claude-haiku-4-5': 'Claude 4.5 Haiku',
    'Claude Code': 'Claude Code',
    'Codex': 'Codex',
    'OpenCode': 'OpenCode',
  };
  return map[name] || name;
}

export default function ModelDropdown({ options, value, onChange, placeholder, disabled, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected ? cleanModelName(selected.label) : (placeholder || 'Select...');

  // Group options
  const grouped: Record<string, Option[]> = useMemo(() => {
    const g: Record<string, Option[]> = {};
    for (const opt of options) {
      const key = opt.group || 'default';
      if (!g[key]) g[key] = [];
      g[key].push(opt);
    }
    return g;
  }, [options]);

  // Calculate position before opening
  const openDropdown = useCallback(() => {
    if (disabled) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200) });
    }
    setOpen(true);
  }, [disabled]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return; // trigger handles own toggle
      if (dropdownRef.current?.contains(target)) return; // inside dropdown
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const handler = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200) });
      }
    };
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const handleSelect = useCallback((optValue: string) => {
    onChange(optValue);
    setOpen(false);
  }, [onChange]);

  const dropdown = open && createPortal(
    <div
      ref={dropdownRef}
      className={styles.dropdown}
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
    >
      {Object.entries(grouped).map(([group, opts]) => (
        <div key={group}>
          {group !== 'default' && (
            <div className={styles.groupLabel}>{group}</div>
          )}
          {opts.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`${styles.item} ${opt.value === value ? styles.itemActive : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              <span className={styles.itemLabel}>
                <ModelIcon model={opt.value} size={16} />
                <span>{cleanModelName(opt.label)}</span>
              </span>
              {opt.value === value && <Check size={14} className={styles.check} />}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );

  return (
    <div className={styles.container}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => open ? setOpen(false) : openDropdown()}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className={styles.triggerLabel}>{displayLabel}</span>
        <ChevronDown size={12} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>
      {dropdown}
    </div>
  );
}
