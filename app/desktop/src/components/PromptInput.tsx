import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Square } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import { ChatInput, StatusBadge } from '@shared/components';
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
  const [prompt, setPrompt] = useState('');
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [model, setModel] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');

  const models = useMemo(() => extractModels(agents), [agents]);

  const { save: saveDraft, flush: flushDraft, clear: clearDraft } =
    useInputDraft(threadId);

  // Restore draft on mount / threadId change
  useEffect(() => {
    if (!threadId) return;
    const saved = localStorage.getItem(`ah:draft:${threadId}`);
    if (saved) setPrompt(saved);
    return () => {
      flushDraft(prompt, threadId);
    };
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush draft on unmount
  useEffect(() => {
    return () => {
      flushDraft(prompt);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist prompt changes to draft
  useEffect(() => {
    saveDraft(prompt);
  }, [prompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const opts: SendOptions = {};
    if (model) opts.model = model;
    if (reasoningEffort) opts.reasoningEffort = reasoningEffort;
    onSend(trimmed, selectedAgentId, opts.model || opts.reasoningEffort ? opts : undefined);
    setPrompt('');
    setShowAgentSelector(false);
    clearDraft();
  }, [prompt, selectedAgentId, model, reasoningEffort, onSend, clearDraft]);

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
              }}
              role="option"
              aria-selected={a.id === selectedAgentId}
            >
              <StatusBadge
                status={a.status === 'available' ? 'online' : 'offline'}
                className={styles.agentStatusDot}
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

        <div className={styles.chatInputWrapper}>
          <ChatInput
            value={prompt}
            onChange={setPrompt}
            onSend={handleSend}
            placeholder={t('prompt.placeholder')}
            disabled={disabled}
          />
          <div className={styles.inputFooter}>
            <span className={styles.charCount}>
              {prompt.length}/{MAX_CHARS}
            </span>
          </div>
        </div>

        {isStreaming && (
          <button
            className={styles.stopBtn}
            onClick={onCancel}
            disabled={disabled}
            aria-label={t('action.cancelRun')}
            title={t('action.cancelRun')}
          >
            <Square size={16} fill="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
}
