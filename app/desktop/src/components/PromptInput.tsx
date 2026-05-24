import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Circle, Square, ArrowUp } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import { useInputDraft } from '@/hooks/useInputDraft';
import { useMention } from '@/hooks/useMention';
import MentionPopover from '@/components/MentionPopover';
import ModelDropdown from '@/components/ModelDropdown';
import styles from './PromptInput.module.css';

const COMMON_MODELS = [
  'claude-opus-4-7', 'claude-opus-4-5',
  'claude-sonnet-4-6', 'claude-haiku-4-5',
];

const REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const MAX_CHARS = 4000;

interface SendOptions { model?: string; reasoningEffort?: ReasoningEffort; }

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

function modelDesc(name: string): string {
  const m: Record<string, string> = {
    'claude-opus-4-7': 'Anthropic flagship — strongest reasoning & coding',
    'claude-opus-4-5': 'Previous-gen flagship, balanced performance',
    'claude-sonnet-4-6': 'Fast, cost-effective for daily tasks',
    'claude-haiku-4-5': 'Lightning-fast for simple tasks',
  };
  return m[name] || '';
}

function modelMeta(name: string): string {
  if (name.includes('opus')) return '200k ctx';
  if (name.includes('sonnet')) return '200k ctx';
  if (name.includes('haiku')) return '200k ctx';
  return '';
}

export default function PromptInput({
  agents, selectedAgentId, onSelectAgent, onSend,
  isStreaming = false, onCancel, disabled, threadId,
}: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [promptLength, setPromptLength] = useState(0);
  const [model, setModel] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');

  const {
    isOpen: mentionOpen, query: mentionQuery, position: mentionPosition,
    selectedIndex: mentionIndex, filteredAgents: mentionFiltered,
    handleInput: mentionHandleInput, handleKeyDown: mentionHandleKeyDown,
    selectAgent: mentionSelectAgent, closeMention,
  } = useMention({ agents, onSelectAgent });

  const { restore: restoreDraft, save: saveDraft, flush: flushDraft, clear: clearDraft } = useInputDraft(threadId);

  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    restoreDraft(ta);
    setPromptLength(ta.value.length);
    return () => { if (ta) flushDraft(ta.value, threadId); };
  }, [threadId]);

  useEffect(() => {
    return () => {
      const ta = inputRef.current;
      if (ta) flushDraft(ta.value);
    };
  }, []);

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
    return () => ta.removeEventListener('input', handleUpdate);
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mentionHandleKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, mentionHandleKeyDown]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const placeholder = selectedAgent
    ? `${t('prompt.placeholder')} @${selectedAgent.name}...`
    : t('prompt.placeholder');

  return (
    <div className={styles.root}>
      <MentionPopover
        agents={mentionFiltered} isOpen={mentionOpen} query={mentionQuery}
        position={mentionPosition} selectedIndex={mentionIndex}
        onSelect={mentionSelectAgent} onClose={closeMention}
      />

      <div className={styles.capsule}>
        {/* selected agent badge */}
        {selectedAgent && (
          <span className={styles.agentBadge}>
            <Circle size={7} fill="currentColor" style={{
              color: selectedAgent.status === 'available' ? 'var(--color-success)' : 'var(--color-danger)',
            }} />
            @{selectedAgent.name}
          </span>
        )}

        {/* borderless textarea */}
        <textarea
          ref={inputRef}
          className={styles.textarea}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
        />

        {/* bottom action bar */}
        <div className={styles.actions}>
          <span className={styles.charCount}>{promptLength}/{MAX_CHARS}</span>

          <div className={styles.metaChain}>
            <ModelDropdown
              options={[
                ...agents.map((a) => ({ value: a.name, label: a.name, group: 'My Agents', desc: a.description || '', meta: a.status === 'available' ? 'Online' : 'Offline', isAgent: true })),
                ...COMMON_MODELS.map((m) => ({ value: m, label: m, group: 'Base Models', desc: modelDesc(m), meta: modelMeta(m), isAgent: false })),
              ]}
              value={model} onChange={setModel}
              placeholder={t('prompt.model')} disabled={disabled} ariaLabel={t('prompt.model')}
              variant="text"
            />
            <span className={styles.metaDot}>·</span>
            <ModelDropdown
              options={REASONING_EFFORTS.map((r) => ({ value: r, label: r, group: 'Reasoning' }))}
              value={reasoningEffort} onChange={(v) => setReasoningEffort(v as ReasoningEffort | '')}
              placeholder={t('prompt.reasoning')} disabled={disabled} ariaLabel={t('prompt.reasoning')} alignRight
              variant="text"
            />
          </div>

          {isStreaming ? (
            <button className={styles.stopBtn} onClick={onCancel} disabled={disabled} aria-label={t('action.cancelRun')}>
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              className={`${styles.sendBtn} ${promptLength > 0 ? styles.sendBtnActive : ''}`}
              onClick={handleSend} disabled={disabled || promptLength === 0}
              aria-label={t('action.startRun')}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
