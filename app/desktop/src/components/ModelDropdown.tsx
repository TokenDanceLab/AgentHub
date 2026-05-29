// Custom model/agent dropdown — Portal-rendered, high-density two-line items.
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Bot } from 'lucide-react';
import { Claude, ClaudeCode, Codex, OpenCode } from '@lobehub/icons';
import { resolveModelDisplayName, type ModelDisplayNameMap } from '@/utils/modelDisplay';
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
  variant?: 'default' | 'text';
  modelDisplayNames?: ModelDisplayNameMap;
}

function AgentDot({ name }: { name: string }) {
  const n = name.toLowerCase();
  const compact = n.replace(/[\s_-]+/g, '');
  if (compact === 'claudecode') return <ClaudeCode size={18} />;
  if (n.includes('codex')) return <Codex size={18} />;
  if (n.includes('opencode')) return <OpenCode size={18} />;
  return <Bot size={16} />;
}

function ModelDot() {
  return <Bot size={15} strokeWidth={1.9} />;
}

function ModelIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes('claude')) return <Claude size={18} />;
  return <ModelDot />;
}

export default function ModelDropdown({ options, value, onChange, placeholder, disabled, ariaLabel, alignRight, variant = 'default', modelDisplayNames }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const showPlaceholder = !selected;
  const displayLabel = selected ? resolveModelDisplayName(selected.label, modelDisplayNames) : (showPlaceholder ? (placeholder || 'Select...') : '');

  const grouped: Record<string, Option[]> = useMemo(() => {
    const g: Record<string, Option[]> = {};
    for (const opt of options) {
      const key = opt.group || 'default';
      if (!g[key]) g[key] = [];
      g[key].push(opt);
    }
    return g;
  }, [options]);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const margin = 12;
      const preferredWidth = options.some((o) => o.isAgent) ? 440 : 280;
      const w = Math.min(Math.max(rect.width, preferredWidth), window.innerWidth - margin * 2);
      const dropdownH = 320;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < dropdownH && spaceAbove > spaceBelow;
      const rawLeft = alignRight ? rect.right - w : rect.left;
      const left = Math.min(Math.max(rawLeft, margin), window.innerWidth - w - margin);
      setPos({
        top: openUp ? rect.top - 4 : rect.bottom + 4,
        left,
        width: w,
        up: openUp,
      });
    }
  }, [alignRight, options]);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    updatePosition();
    setOpen(true);
  }, [disabled, updatePosition]);

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
      updatePosition();
    };
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => { window.removeEventListener('scroll', handler, true); window.removeEventListener('resize', handler); };
  }, [open, updatePosition]);

  const handleSelect = useCallback((optValue: string) => {
    onChange(optValue);
    setOpen(false);
  }, [onChange]);

  const dropdown = open && createPortal(
    <div ref={dropdownRef}
      className={`${styles.dropdown} ${pos.up ? styles.dropdownUp : ''}`}
      style={{
        position: 'fixed', zIndex: 9999,
        top: pos.up ? 'auto' : pos.top,
        bottom: pos.up ? `${window.innerHeight - pos.top}px` : 'auto',
        left: pos.left,
        right: 'auto',
        width: pos.width,
      }}>
      {Object.entries(grouped).map(([group, opts], gi) => (
        <div key={group}>
          {gi > 0 && <div className={styles.separator} />}
          {group !== 'default' && <div className={styles.groupLabel}>{group}</div>}
          {opts.map((opt) => {
            const compact = !opt.isAgent;
            return (
            <button key={opt.value} type="button"
              className={`${styles.item} ${compact ? styles.itemCompact : ''} ${opt.value === value ? styles.itemActive : ''}`}
              onClick={() => handleSelect(opt.value)}>
              <span className={styles.itemIcon}>
                {opt.isAgent ? <AgentDot name={opt.label} /> : <ModelIcon name={opt.label} />}
              </span>
              <span className={styles.itemBody}>
                <span className={styles.itemName}>{resolveModelDisplayName(opt.label, modelDisplayNames)}</span>
                {opt.desc && !compact && <span className={styles.itemDesc}>{opt.desc}</span>}
              </span>
              <span className={styles.itemRight}>
                {opt.meta && <span className={styles.itemMeta}>{opt.meta}</span>}
                {opt.value === value && <Check size={14} className={styles.check} />}
              </span>
            </button>
            );
          })}
        </div>
      ))}
    </div>, document.body);

  return (
    <div className={styles.container}>
      <button ref={triggerRef} type="button"
        className={`${styles.trigger} ${variant === 'text' ? styles.triggerText : ''}`}
        onClick={() => open ? setOpen(false) : openDropdown()}
        disabled={disabled} aria-label={ariaLabel} aria-expanded={open}>
        <span className={styles.triggerLabel}>{displayLabel}</span>
        {variant !== 'text' && <ChevronDown size={12} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />}
      </button>
      {dropdown}
    </div>
  );
}
