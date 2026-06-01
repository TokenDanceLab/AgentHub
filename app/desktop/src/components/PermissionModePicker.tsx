import { ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface PermissionModeOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  label: string;
  options: PermissionModeOption[];
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}

export default function PermissionModePicker({
  value,
  label,
  options,
  disabled = false,
  ariaLabel,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label ?? label;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid var(--border-color, #e0e0e0)',
          background: 'var(--bg-secondary, #f5f5f5)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13,
        }}
      >
        <span>{displayLabel}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border-color, #e0e0e0)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 100,
            minWidth: 140,
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: option.value === value ? 'var(--accent-bg, #e8f0fe)' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
