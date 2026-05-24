import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Circle, Square } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import { useInputDraft } from '@/hooks/useInputDraft';
import { useMention } from '@/hooks/useMention';
import MentionPopover from '@/components/MentionPopover';
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
  const [model, setModel] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [textareaFocused, setTextareaFocused] = useState(false);

  const models = useMemo(() => extractModels(agents), [agents]);

  const {
    isOpen: mentionOpen,
    query: mentionQuery,
    position: mentionPosition,
    selectedIndex: mentionIndex,
    filteredAgents: mentionFiltered,
    handleInput: mentionHandleInput,
    handleKeyDown: mentionHandleKeyDown,
    selectAgent: mentionSelectAgent,
    closeMention,
  } = useMention({ agents, onSelectAgent });

  const { restore: restoreDraft, save: saveDraft, flush: flushDraft, clear: clearDraft } =
    useInputDraft(threadId);

  // Restore draft on mount / threadId change
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    restoreDraft(ta);
    setPromptLength(ta.value.length);
    return () => {
      if (ta) flushDraft(ta.value, threadId);
    };
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush draft on unmount
  useEffect(() => {
    return () => {
      const ta = inputRef.current;
      if (ta) flushDraft(ta.value);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea, track character count, detect @mention on input
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;

    const handleUpdate = () => {
      setPromptLength(ta.value.length);
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
      saveDraft(ta.value);
      mentionHandleInput();
    };

    ta.addEventListener('input', handleUpdate);
    ta.addEventListener('change', handleUpdate);
    return () => {
      ta.removeEventListener('input', handleUpdate);
      ta.removeEventListener('change', handleUpdate);
    };
  }, [mentionHandleInput]);

  const handleSend = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    const trimmed = ta.value.trim();
    if (!trimmed) return;
    const opts: SendOptions = {};
    if (model) opts.model = model;
    if (reasoningEffort) opts.reasoningEffort = reasoningEffort;
    onSend(trimmed, selectedAgentId, opts.model || opts.reasoningEffort ? opts : undefined);
    ta.value = '';
    ta.style.height = 'auto';
    setPromptLength(0);
    closeMention();
    clearDraft();
  }, [selectedAgentId, model, reasoningEffort, onSend, clearDraft, closeMention]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Delegate to mention handler first; if consumed, skip default Enter handling
      if (mentionHandleKeyDown(e)) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mentionHandleKeyDown],
  );

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <div className={styles.root}>
      {/* @mention inline popover */}
      <MentionPopover
        agents={mentionFiltered}
        isOpen={mentionOpen}
        query={mentionQuery}
        position={mentionPosition}
        selectedIndex={mentionIndex}
        onSelect={mentionSelectAgent}
        onClose={closeMention}
      />

      <div className={styles.inputCard}>
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
        {selectedAgent && (
          <span className={styles.selectedAgentBadge}>
            <Circle
              size={8}
              fill="currentColor"
              style={{
                color:
                  selectedAgent.status === 'available'
                    ? 'var(--color-success)'
                    : 'var(--color-danger)',
              }}
            />
            @{selectedAgent.name}
          </span>
        )}

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
            <div className={styles.buttonGroup}>
              <span className={styles.charCount}>
                {promptLength}/{MAX_CHARS}
              </span>
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
        </div>
      </div>
      </div>
    </div>
  );
}
