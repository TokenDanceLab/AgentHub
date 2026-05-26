import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Check, ChevronDown, Sparkles } from 'lucide-react';
import { Claude } from '@lobehub/icons';
import styles from './ModelReasoningPicker.module.css';

export interface ModelReasoningOption {
  value: string;
  label: string;
  provider?: string;
}

export interface ReasoningOption {
  value: string;
  label: string;
}

interface Props {
  models: ModelReasoningOption[];
  modelValue: string;
  modelLabel: string;
  reasoningValue: string;
  reasoningLabel: string;
  reasoningOptions: ReasoningOption[];
  disabled?: boolean;
  ariaLabel?: string;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
}

function cleanModelName(name: string): string {
  const map: Record<string, string> = {
    'claude-opus-4-7': 'Claude 4.7 Opus',
    'claude-opus-4-5': 'Claude 4.5 Opus',
    'claude-sonnet-4-6': 'Claude 4.6 Sonnet',
    'claude-haiku-4-5': 'Claude 4.5 Haiku',
  };
  return map[name] || name;
}

function ModelIcon({ name }: { name: string }) {
  return name.toLowerCase().includes('claude') ? <Claude size={18} /> : <Bot size={16} />;
}

export default function ModelReasoningPicker({
  models,
  modelValue,
  modelLabel,
  reasoningValue,
  reasoningLabel,
  reasoningOptions,
  disabled,
  ariaLabel,
  onModelChange,
  onReasoningChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const displayModel = cleanModelName(modelLabel || modelValue);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(Math.max(rect.width, 460), window.innerWidth - margin * 2);
    const height = 334;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const up = spaceBelow < height && spaceAbove > spaceBelow;
    setPos({
      top: up ? rect.top - 4 : rect.bottom + 6,
      left: Math.min(Math.max(rect.right - width, margin), window.innerWidth - width - margin),
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

  const selectedModel = useMemo(
    () => models.find((model) => model.value === modelValue),
    [modelValue, models],
  );

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
      <div className={styles.sectionLabel}>Model</div>
      <div className={styles.modelList}>
        {models.map((model) => {
          const selected = model.value === modelValue || (!selectedModel && cleanModelName(model.value) === displayModel);
          return (
            <div key={model.value} className={`${styles.modelRow} ${selected ? styles.modelRowActive : ''}`}>
              <button
                type="button"
                className={styles.modelButton}
                onClick={() => onModelChange(model.value)}
              >
                <span className={styles.modelIcon}><ModelIcon name={model.value} /></span>
                <span className={styles.modelText}>
                  <span className={styles.modelName}>{cleanModelName(model.label)}</span>
                  {model.provider && <span className={styles.modelProvider}>{model.provider}</span>}
                </span>
                {selected && <Check size={15} className={styles.check} />}
              </button>
              {selected && (
                <div className={styles.reasoningStrip} aria-label="Reasoning level">
                  {reasoningOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.reasoningChip} ${option.value === reasoningValue ? styles.reasoningChipActive : ''}`}
                      onClick={() => onReasoningChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
        <span className={styles.providerDot} aria-hidden="true">
          <Sparkles size={14} />
        </span>
        <span className={styles.triggerModel}>{displayModel}</span>
        <span className={styles.triggerReasoning}>{reasoningLabel}</span>
        <ChevronDown size={13} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>
      {popover}
    </div>
  );
}
