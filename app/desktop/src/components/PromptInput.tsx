import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Send, Circle, Square } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import { useInputDraft } from '@/hooks/useInputDraft';
import styles from './PromptInput.module.css';

const COMMON_MODELS = [
  'claude-opus-4-7',
  'claude-opus-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

const REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const MAX_CHARS = 4000;

interface SendOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

interface Props {
  agents: AgentInfo[];
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onSend: (prompt: string, agentId?: string, opts?: SendOptions) => void;
  isStreaming?: boolean;
  onCancel?: () => void;
  disabled?: boolean;
  /** Optional thread ID for draft persistence. When provided, input text is saved/restored via localStorage. */
  threadId?: string;
}

function extractModels(agents: AgentInfo[]): string[] {
  const fromAgents = agents.map((a) => a.name).filter(Boolean);
  return [...new Set([...fromAgents, ...COMMON_MODELS])];
}

export default function PromptInput({
  agents,
  selectedAgentId,
  onSelectAgent,
  onSend,
  isStreaming = false,
  onCancel,
  disabled,
  threadId,
}: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [promptLength, setPromptLength] = useState(0);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [model, setModel] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [textareaFocused, setTextareaFocused] = useState(false);

  const models = useMemo(() => extractModels(agents), [agents]);

  const { restore: restoreDraft, save: saveDraft, flush: flushDraft, clear: clearDraft } =
    useInputDraft(threadId);

  // Restore draft on mount / threadId change
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    restoreDraft(ta);
    setPromptLength(ta.value.length);
    // Restore also handles auto-resize inside the hook
    return () => {
      // Flush pending draft for the old threadId before switching
      if (ta) flushDraft(ta.value, threadId);
    };
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush draft on unmount (cleanup)
  useEffect(() => {
    return () => {
      const ta = inputRef.current;
      if (ta) flushDraft(ta.value);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea and track character count on input
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;

    const handleUpdate = () => {
      setPromptLength(ta.value.length);
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
      saveDraft(ta.value);
    };

    ta.addEventListener('input', handleUpdate);
    // Also listen for 'change' so test simulated events update promptLength
    ta.addEventListener('change', handleUpdate);
    return () => {
      ta.removeEventListener('input', handleUpdate);
      ta.removeEventListener('change', handleUpdate);
    };
  }, []);

  const handleSend = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    const trimmed = ta.value.trim();
    if (!trimmed) return;
    const opts: SendOptions = {};
    if (model) opts.model = model;
    if (reasoningEffort) opts.reasoningEffort = reasoningEffort;
    onSend(trimmed, selectedAgentId, opts.model || opts.reasoningEffort ? opts : undefined);
    // Clear input
    ta.value = '';
    ta.style.height = 'auto';
    setPromptLength(0);
    setShowAgentSelector(false);
    clearDraft();
  }, [selectedAgentId, model, reasoningEffort, onSend, clearDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <div className={styles.root}>
      {showAgentSelector && (
        <div className={styles.selector} role="listbox" aria-label={t('prompt.agentSelector')}>
          {agents.map((a) => (
            <button
              key={a.id}
              className={`${styles.option} ${a.id === selectedAgentId ? styles.optionSelected : ''}`}
              onClick={() => {
                onSelectAgent(a.id);
                setShowAgentSelector(false);
                inputRef.current?.focus();
              }}
              role="option"
              aria-selected={a.id === selectedAgentId}
            >
              <Circle
                size={8}
                fill="currentColor"
                style={{
                  color: a.status === 'available' ? 'var(--color-success)' : 'var(--color-danger)',
                }}
              />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.configRow}>
        <select
          className={styles.select}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={disabled}
          aria-label={t('prompt.model')}
        >
          <option value="">{t('prompt.model')}</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={reasoningEffort}
          onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort | '')}
          disabled={disabled}
          aria-label={t('prompt.reasoning')}
        >
          <option value="">{t('prompt.reasoning')}</option>
          {REASONING_EFFORTS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.bar}>
        <button
          className={styles.agentBtn}
          onClick={() => setShowAgentSelector((v) => !v)}
          disabled={disabled || agents.length === 0}
          title={t('prompt.agentSelector')}
        >
          {selectedAgent ? `@${selectedAgent.name}` : '@Agent'}
          <ChevronDown size={14} />
        </button>

        <div className={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            className={styles.textarea}
            onKeyDown={handleKeyDown}
            onFocus={() => setTextareaFocused(true)}
            onBlur={() => setTextareaFocused(false)}
            placeholder={t('prompt.placeholder')}
            disabled={disabled}
            rows={1}
          />
          <div className={styles.inputFooter}>
            <span className={styles.enterHint}>
              <kbd className={styles.shortcutKey}>{textareaFocused ? 'Shift+Enter' : 'Enter'}</kbd>
            </span>
            <span className={styles.charCount}>
              {promptLength}/{MAX_CHARS}
            </span>
          </div>
        </div>

        {isStreaming ? (
          <button
            className={styles.stopBtn}
            onClick={onCancel}
            disabled={disabled}
            aria-label={t('action.cancelRun')}
            title={t('action.cancelRun')}
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={disabled || promptLength === 0}
            aria-label={t('action.startRun')}
            title={t('action.startRun')}
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
