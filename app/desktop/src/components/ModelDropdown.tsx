// Custom model/agent dropdown — Portal-rendered, high-density two-line items.
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { ModelIcon, ClaudeCode, Codex, OpenCode } from '@lobehub/icons';
import styles from './ModelDropdown.module.css';

interface Option {
  value: string;
  label: string;
  group?: string;
  desc?: string;
  meta?: string;
  isAgent?: boolean;
}

interface Props {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  alignRight?: boolean;
}

function cleanModelName(name: string): string {
  const map: Record<string, string> = {
    'claude-opus-4-7': 'Claude 4.7 Opus', 'claude-opus-4-5': 'Claude 4.5 Opus',
    'claude-sonnet-4-6': 'Claude 4.6 Sonnet', 'claude-haiku-4-5': 'Claude 4.5 Haiku',
    'Claude Code': 'Claude Code', 'Codex': 'Codex', 'OpenCode': 'OpenCode',
  };
  return map[name] || name;
}

function AgentDot({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes('claude')) return <ClaudeCode size={18} />;
  if (n.includes('codex')) return <Codex size={18} />;
  if (n.includes('opencode')) return <OpenCode size={18} />;
  return <ModelIcon model={name} size={18} />;
}

export default function ModelDropdown({ options, value, onChange, placeholder, disabled, ariaLabel, alignRight }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected ? cleanModelName(selected.label) : (placeholder || 'Select...');

  const grouped: Record<string, Option[]> = useMemo(() => {
    const g: Record<string, Option[]> = {};
    for (const opt of options) {
      const key = opt.group || 'default';
      if (!g[key]) g[key] = [];
      g[key].push(opt);
    }
    return g;
  }, [options]);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const w = Math.max(rect.width, 280);
      setPos({ top: rect.bottom + 4, left: alignRight ? rect.right - w : rect.left, width: w });
    }
    setOpen(true);
  }, [disabled, alignRight]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const w = Math.max(rect.width, 280);
        setPos({ top: rect.bottom + 4, left: alignRight ? rect.right - w : rect.left, width: w });
      }
    };
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => { window.removeEventListener('scroll', handler, true); window.removeEventListener('resize', handler); };
  }, [open, alignRight]);

  const handleSelect = useCallback((optValue: string) => {
    onChange(optValue);
    setOpen(false);
  }, [onChange]);

  const dropdown = open && createPortal(
    <div ref={dropdownRef} className={styles.dropdown}
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}>
      {Object.entries(grouped).map(([group, opts]) => (
        <div key={group}>
          {group !== 'default' && <div className={styles.groupLabel}>{group}</div>}
          {opts.map((opt) => (
            <button key={opt.value} type="button"
              className={`${styles.item} ${opt.value === value ? styles.itemActive : ''}`}
              onClick={() => handleSelect(opt.value)}>
              <span className={styles.itemIcon}>
                {opt.isAgent ? <AgentDot name={opt.label} /> : <ModelIcon model={opt.value} size={18} />}
              </span>
              <span className={styles.itemBody}>
                <span className={styles.itemName}>{cleanModelName(opt.label)}</span>
                {opt.desc && <span className={styles.itemDesc}>{opt.desc}</span>}
              </span>
              <span className={styles.itemRight}>
                {opt.meta && <span className={styles.itemMeta}>{opt.meta}</span>}
                {opt.value === value && <Check size={14} className={styles.check} />}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>, document.body);

  return (
    <div className={styles.container}>
      <button ref={triggerRef} type="button" className={styles.trigger}
        onClick={() => open ? setOpen(false) : openDropdown()}
        disabled={disabled} aria-label={ariaLabel} aria-expanded={open}>
        <span className={styles.triggerLabel}>{displayLabel}</span>
        <ChevronDown size={12} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>
      {dropdown}
    </div>
  );
}
