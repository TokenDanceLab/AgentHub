import { useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Send, Circle } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import styles from './PromptInput.module.css';

const COMMON_MODELS = [
  'claude-opus-4-7',
  'claude-opus-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

const REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

interface SendOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

interface Props {
  agents: AgentInfo[];
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onSend: (prompt: string, agentId?: string, opts?: SendOptions) => void;
  disabled?: boolean;
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
  disabled,
}: Props) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [model, setModel] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const models = useMemo(() => extractModels(agents), [agents]);

  const handleSend = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const opts: SendOptions = {};
    if (model) opts.model = model;
    if (reasoningEffort) opts.reasoningEffort = reasoningEffort;
    onSend(trimmed, selectedAgentId, opts.model || opts.reasoningEffort ? opts : undefined);
    setPrompt('');
    setShowAgentSelector(false);
  }, [prompt, selectedAgentId, model, reasoningEffort, onSend]);

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

        <input
          ref={inputRef}
          className={styles.input}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('prompt.placeholder')}
          disabled={disabled}
        />

        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={disabled || !prompt.trim()}
        >
          <Send size={14} />
          {t('action.startRun')}
        </button>
      </div>
    </div>
  );
}
