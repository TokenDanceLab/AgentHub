import { useState, useRef, useCallback, useEffect, useId, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useExiting } from './useExiting';
import styles from './Select.module.css';

export interface SelectProps {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

export function Select({ value, options, onChange, placeholder, className, ariaLabel }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const [position, setPosition] = useState<'down' | 'up'>('down');
  const [triggerWidth, setTriggerWidth] = useState(158);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
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

  // Position: flip up if near bottom
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const anchorRect = triggerRef.current.getBoundingClientRect();
    setTriggerWidth(anchorRect.width);
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    // Estimate panel height ~ 40px * min(6, options.length) + 16px padding
    const approxPanelH = Math.min(6, options.length) * 40 + 16;
    setPosition(spaceBelow < approxPanelH + 8 ? 'up' : 'down');
  }, [open, options.length]);

  // Focus selected on open
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex(([v]) => v === value);
    setFocusIdx(idx >= 0 ? idx : 0);
  }, [open, value, options]);

  // Restore focus on close
  useEffect(() => {
    if (!open && mountedRef.current) {
      triggerRef.current?.focus();
    }
    mountedRef.current = true;
  }, [open]);

  const handleKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIdx((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIdx((i) => (i - 1 + options.length) % options.length);
        break;
      case 'Home':
        e.preventDefault();
        if (open) setFocusIdx(0);
        break;
      case 'End':
        e.preventDefault();
        if (open) setFocusIdx(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open && options[focusIdx]) {
          onChange(options[focusIdx][0]);
          close();
        } else {
          setOpen(true);
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      default:
        // Typeahead: consecutive printable characters jump to the first option
        // whose label contains the accumulated string (resets after 500ms).
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
          const matchIdx = options.findIndex(([, label]) =>
            label.toLowerCase().includes(needle),
          );
          if (matchIdx >= 0) setFocusIdx(matchIdx);
        }
        break;
    }
  };

  const triggerClass = [styles.trigger, className].filter(Boolean).join(' ');

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
      >
        <span className={selectedLabel ? styles.label : styles.placeholder}>
          {selectedLabel || placeholder || ' '}
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
              triggerRef.current
                ? {
                    position: 'absolute',
                    left: triggerRef.current.getBoundingClientRect().left,
                    minWidth: triggerWidth,
                    width: triggerWidth,
                    [position === 'up' ? 'bottom' : 'top']:
                      position === 'up'
                        ? window.innerHeight - triggerRef.current.getBoundingClientRect().top + 6
                        : triggerRef.current.getBoundingClientRect().bottom + 6,
                  }
                : undefined
            }
          >
            {options.map(([optValue, label], idx) => (
              <button
                key={optValue}
                id={optionId(idx)}
                type="button"
                tabIndex={-1}
                className={`${styles.option} ${optValue === value ? styles.optionSelected : ''} ${idx === focusIdx ? styles.optionFocused : ''}`}
                role="option"
                aria-selected={optValue === value}
                onClick={() => {
                  onChange(optValue);
                  close();
                }}
                onMouseEnter={() => setFocusIdx(idx)}
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
