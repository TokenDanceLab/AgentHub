import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Send, Circle } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import styles from './PromptInput.module.css';

interface Props {
  agents: AgentInfo[];
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onSend: (prompt: string, agentId?: string) => void;
  disabled?: boolean;
}

export default function PromptInput({ agents, selectedAgentId, onSelectAgent, onSend, disabled }: Props) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [showSelector, setShowSelector] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onSend(trimmed, selectedAgentId);
    setPrompt('');
    setShowSelector(false);
  }, [prompt, selectedAgentId, onSend]);

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
      {showSelector && (
        <div className={styles.selector} role="listbox" aria-label={t('prompt.agentSelector')}>
          {agents.map((a) => (
            <button
              key={a.id}
              className={`${styles.option} ${a.id === selectedAgentId ? styles.optionSelected : ''}`}
              onClick={() => {
                onSelectAgent(a.id);
                setShowSelector(false);
                inputRef.current?.focus();
              }}
              role="option"
              aria-selected={a.id === selectedAgentId}
            >
              <Circle size={8} fill="currentColor" style={{ color: a.status === 'available' ? 'var(--color-success)' : 'var(--color-danger)' }} />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.bar}>
        <button
          className={styles.agentBtn}
          onClick={() => setShowSelector((v) => !v)}
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
