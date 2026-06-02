import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Check, ChevronDown } from 'lucide-react';
import { Claude, DeepSeek, Doubao, Kimi, Minimax, OpenAI, Qwen, XiaomiMiMo, Zhipu } from '@lobehub/icons';
import { useTranslation } from 'react-i18next';
import { resolveModelDisplayName, type ModelDisplayNameMap } from '@/utils/modelDisplay';
import styles from './ModelReasoningPicker.module.css';

export interface ModelReasoningOption {
  id?: string;
  value: string;
  label: string;
  provider?: string;
  providerId?: string;
  requestModel?: string;
  modelAlias?: string;
  source?: string;
  sourceId?: string;
  runtimeId?: string;
  resolvedModel?: string;
  routeKind?: 'config' | 'mapping' | 'default' | 'direct';
  routeLabel?: string;
  description?: string;
  status?: string;
  default?: boolean;
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
  modelDisplayNames?: ModelDisplayNameMap;
  onModelChange: (value: string, option?: ModelReasoningOption) => void;
  onReasoningChange: (value: string) => void;
}

function BrandModelIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes('deepseek')) return <DeepSeek size={18} />;
  if (lower.includes('mimo') || lower.includes('xiaomi')) return <XiaomiMiMo size={18} />;
  if (lower.includes('minimax')) return <Minimax size={18} />;
  if (lower.includes('glm') || lower.includes('chatglm') || lower.includes('zhipu')) return <Zhipu size={18} />;
  if (lower.includes('kimi') || lower.includes('moonshot')) return <Kimi size={18} />;
  if (lower.includes('qwen')) return <Qwen size={18} />;
  if (lower.includes('doubao')) return <Doubao size={18} />;
  if (/\b(gpt|openai)\b/.test(lower) || lower.includes('gpt-') || /\b(o[1345])\b/.test(lower)) {
    return <OpenAI size={18} />;
  }
  if (lower.includes('claude')) return <Claude size={18} />;
  return <Bot size={16} />;
}

function DecorativeBrandModelIcon({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    ref.current?.querySelectorAll('title').forEach((node) => node.remove());
  });

  return (
    <span ref={ref} className={styles.decorativeModelIcon} aria-hidden="true">
      <BrandModelIcon name={name} />
    </span>
  );
}

function modelMeta(model: ModelReasoningOption): string {
  if (!model.provider || model.provider === 'TokenDance') return '';
  if (model.provider === 'Claude Code' || model.provider === 'Codex' || model.provider === 'OpenCode') return '';
  return model.provider;
}

function optionKey(model: ModelReasoningOption): string {
  return `${model.id ?? model.value}:${model.sourceId ?? model.source ?? ''}:${model.runtimeId ?? ''}`;
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
  modelDisplayNames,
  onModelChange,
  onReasoningChange,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const displayModel = resolveModelDisplayName(modelLabel || modelValue, modelDisplayNames);
  const selectedModel = useMemo(
    () => models.find((model) => model.value === modelValue),
    [modelValue, models],
  );
  const selectedModelKey = selectedModel ? optionKey(selectedModel) : '';
  const triggerIconName = selectedModel
    ? `${selectedModel.label} ${selectedModel.resolvedModel ?? ''} ${selectedModel.requestModel ?? ''}`
    : `${modelLabel} ${modelValue}`;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(Math.max(rect.width, 356), window.innerWidth - margin * 2);
    const height = Math.min(300, 68 + models.length * 38);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const up = spaceBelow < height && spaceAbove > spaceBelow;
    setPos({
      top: up ? rect.top - 4 : rect.bottom + 6,
      left: Math.min(Math.max(rect.right - width, margin), window.innerWidth - width - margin),
      width,
      up,
    });
  }, [models.length]);

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
      <div className={styles.reasoningBar} aria-label={t('prompt.reasoning')}>
        <span className={styles.sectionLabel}>{t('prompt.reasoning')}</span>
        <div className={styles.reasoningOptions}>
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
      </div>
      <div className={styles.sectionLabel}>{t('prompt.modelRoute')}</div>
      <div className={styles.modelList}>
        {models.map((model) => {
          const selected = selectedModel
            ? optionKey(model) === selectedModelKey
            : resolveModelDisplayName(model.value, modelDisplayNames) === displayModel;
          const meta = modelMeta(model);
          return (
            <div key={optionKey(model)} className={`${styles.modelRow} ${selected ? styles.modelRowActive : ''}`}>
              <button
                type="button"
                className={styles.modelButton}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onModelChange(model.value, model)}
                title={[
                  model.resolvedModel && model.resolvedModel !== model.value ? `Resolves to ${model.resolvedModel}` : '',
                  model.description,
                ].filter(Boolean).join('\n') || undefined}
              >
                <span className={styles.modelIcon}>
                  <DecorativeBrandModelIcon name={`${model.label} ${model.resolvedModel ?? ''} ${model.requestModel ?? ''}`} />
                </span>
                <span className={styles.modelText}>
                  <span className={styles.modelName}>{resolveModelDisplayName(model.label, modelDisplayNames)}</span>
                </span>
                {meta && <span className={styles.modelProvider}>{meta}</span>}
                {selected && <Check size={15} className={styles.check} />}
              </button>
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
          <DecorativeBrandModelIcon name={triggerIconName} />
        </span>
        <span className={styles.triggerModel}>{displayModel}</span>
        <span className={styles.triggerReasoning}>{reasoningLabel}</span>
        <ChevronDown size={13} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>
      {popover}
    </div>
  );
}
