import { useState, useRef, useCallback, useEffect, useId, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useExiting } from './useExiting';
import { cx } from './cx';
import styles from './Select.module.css';

/** Option tuple: [value, label, disabled?] — the 2-tuple form stays valid (#1827). */
export type SelectOption = [value: string, label: string, disabled?: boolean];

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  /** Unified error state (semantic + visual): aria-invalid + --td-danger ring on the trigger. */
  invalid?: boolean;
}

/** First enabled index at or after `from`, wrapping; -1 when none are enabled. */
function nextEnabled(options: SelectOption[], from: number, dir: 1 | -1): number {
  const len = options.length;
  if (len === 0) return -1;
  let i = from;
  for (let n = 0; n < len; n++) {
    i = (i + dir + len) % len;
    if (!options[i]?.[2]) return i;
  }
  return -1;
}

function clampToEnabled(options: SelectOption[], idx: number): number {
  if (!options[idx]?.[2]) return idx;
  const next = nextEnabled(options, idx, 1);
  return next >= 0 ? next : idx;
}

interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export function Select({ value, options, onChange, placeholder, className, ariaLabel, invalid = false }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const [position, setPosition] = useState<'down' | 'up'>('down');
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Tracks the previous `open` value so the restore-focus effect reacts only
  // to a true open -> close transition. A plain "mounted" flag is not enough:
  // React 19 + StrictMode re-runs effects on the simulated second mount while
  // refs persist, so an effect-initialized flag would fire focus() on the
  // second pass (open === false both times) — stealing focus on page load
  // (dev-only double blue focus ring on the workbench status form).
  const wasOpenRef = useRef(false);
  const typeaheadRef = useRef<{ chars: string; timer: ReturnType<typeof setTimeout> | null }>({
    chars: '',
    timer: null,
  });
  const listboxId = useId();

  // Keep the dropdown mounted briefly on close so its exit animation plays
  // (#1825); reduced-motion drops it immediately.
  const { mounted, exiting } = useExiting(open, 140);

  const optionId = (idx: number) => `${listboxId}-option-${idx}`;

  const selectedLabel = options.find(([v]) => v === value)?.[1] ?? placeholder ?? '';

  const close = useCallback(() => {
    setOpen(false);
    setFocusIdx(0);
  }, []);

  // Measure the trigger and decide flip-up/down (#1827: recomputed on open
  // AND on window resize — a resized viewport must not leave the anchor stale).
  const recomputeAnchor = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width });
    const spaceBelow = window.innerHeight - rect.bottom;
    // Estimate panel height ~ 40px * min(6, options.length) + 16px padding
    const approxPanelH = Math.min(6, options.length) * 40 + 16;
    setPosition(spaceBelow < approxPanelH + 8 ? 'up' : 'down');
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    recomputeAnchor();
    window.addEventListener('resize', recomputeAnchor);
    return () => window.removeEventListener('resize', recomputeAnchor);
  }, [open, recomputeAnchor]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      )
        return;
      close();
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open, close]);

  // Focus selected on open (skipping disabled options)
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex(([v]) => v === value);
    setFocusIdx(clampToEnabled(options, idx >= 0 ? idx : 0));
  }, [open, value, options]);

  // Restore focus on close — only for a real open -> close transition, never
  // on mount (including StrictMode's second effect pass where open stays
  // false and refs persist from the first pass).
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (wasOpen && !open) {
      triggerRef.current?.focus();
    }
  }, [open]);

  const handleKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = nextEnabled(options, focusIdx, 1);
        if (next >= 0) setFocusIdx(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = nextEnabled(options, focusIdx, -1);
        if (prev >= 0) setFocusIdx(prev);
        break;
      }
      case 'Home':
        e.preventDefault();
        if (open) {
          const first = nextEnabled(options, -1, 1);
          if (first >= 0) setFocusIdx(first);
        }
        break;
      case 'End':
        e.preventDefault();
        if (open) {
          const last = nextEnabled(options, options.length, -1);
          if (last >= 0) setFocusIdx(last);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) {
          const current = options[focusIdx];
          if (current && !current[2]) {
            onChange(current[0]);
            close();
          }
        } else {
          setOpen(true);
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      default:
        // Typeahead: consecutive printable characters jump to the first enabled
        // option whose label contains the accumulated string (resets after 500ms).
        if (open && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          const typeahead = typeaheadRef.current;
          if (typeahead.timer) clearTimeout(typeahead.timer);
          typeahead.chars = (typeahead.chars + e.key).slice(-64);
          typeahead.timer = setTimeout(() => {
            typeahead.chars = '';
            typeahead.timer = null;
          }, 500);
          const needle = typeahead.chars.toLowerCase();
          const matchIdx = options.findIndex(([, label], i) => !options[i]?.[2] && label.toLowerCase().includes(needle));
          if (matchIdx >= 0) setFocusIdx(matchIdx);
        }
        break;
    }
  };

  const triggerClass = cx(styles.trigger, invalid && styles.triggerInvalid, className);

  return (
    <span className={styles.container}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        {...(invalid ? { 'aria-invalid': true } : {})}
      >
        <span className={selectedLabel ? styles.label : styles.placeholder}>
          {selectedLabel || placeholder || ' '}
        </span>
        <svg
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {mounted &&
        createPortal(
          <div
            ref={dropdownRef}
            className={`${styles.dropdown} ${position === 'up' ? styles.dropdownUp : ''}${exiting ? ` ${styles.dropdownClosing}` : ''}`}
            role="listbox"
            id={listboxId}
            aria-activedescendant={optionId(focusIdx)}
            onKeyDown={handleKey}
            style={
              anchor
                ? {
                    position: 'absolute',
                    left: anchor.left,
                    minWidth: anchor.width,
                    width: anchor.width,
                    [position === 'up' ? 'bottom' : 'top']:
                      position === 'up'
                        ? window.innerHeight - anchor.top + 6
                        : anchor.bottom + 6,
                  }
                : undefined
            }
          >
            {options.map(([optValue, label, disabled], idx) => (
              <button
                key={optValue}
                id={optionId(idx)}
                type="button"
                tabIndex={-1}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                className={`${styles.option} ${optValue === value ? styles.optionSelected : ''} ${idx === focusIdx ? styles.optionFocused : ''} ${disabled ? styles.optionDisabled : ''}`}
                role="option"
                aria-selected={optValue === value}
                onClick={() => {
                  if (disabled) return;
                  onChange(optValue);
                  close();
                }}
                onMouseEnter={() => !disabled && setFocusIdx(idx)}
              >
                <span className={styles.optionLabel}>{label}</span>
                {optValue === value && (
                  <svg className={styles.check} width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l3.5 3.5L12 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
