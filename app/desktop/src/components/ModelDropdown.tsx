// Custom model/agent dropdown — replaces native <select> with styled popover.
import { useState, useRef, useEffect, useCallback } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const displayLabel = selected ? cleanModelName(selected.label) : (placeholder || 'Select...');

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = useCallback((optValue: string) => {
    onChange(optValue);
    setOpen(false);
  }, [onChange]);

  // Group options
  const grouped: Record<string, Option[]> = {};
  for (const opt of options) {
    const g = opt.group || 'default';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(opt);
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className={styles.triggerLabel}>{displayLabel}</span>
        <ChevronDown size={12} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>

      {open && (
        <div className={styles.dropdown}>
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
        </div>
      )}
    </div>
  );
}
