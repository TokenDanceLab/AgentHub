import { useState, useRef, useCallback, memo, useMemo } from 'react';
import { Send } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import { useMention, type MentionItem } from '@/hooks/useMention';
import { useComposerCore } from '@/hooks/useComposerCore';
import MentionPopover from '@/components/MentionPopover';
import type { IMMessageMention, ComposerPayload } from './types';
import styles from './IMMessageInput.module.css';

const MAX_CHARS = 2000;

interface IMMessageInputProps {
  /** Called when user sends a message. Returns true/false to indicate acceptance. */
  onSend: (content: string, mentions?: IMMessageMention[]) => boolean | undefined | Promise<boolean | undefined>;
  disabled?: boolean;
  placeholder?: string;
  /** Agents available for @mention. */
  agents?: AgentInfo[];
}

export interface SendPayload extends ComposerPayload {}

const IMMessageInput = memo(function IMMessageInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
  agents = [],
}: IMMessageInputProps) {
  const [value, setValue] = useState('');
  const [mentionedAgents, setMentionedAgents] = useState<IMMessageMention[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { autoResize, clearTextarea, handleEnterKey, trimForSend } = useComposerCore({ disabled });

  // Build mention items from the agents prop
  const mentionItems = useMemo<MentionItem[]>(
    () =>
      agents.map((agent) => ({
        id: `agent:${agent.id}`,
        kind: 'agent' as const,
        label: agent.name,
        ...(agent.description ? { description: agent.description } : {}),
        status: agent.status,
        keywords: [agent.id, agent.name, 'agent', 'runtime'],
        replacementText: '',
        agent,
      })),
    [agents],
  );

  const onSelectAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;
      setMentionedAgents((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.agentId === agentId)) return prev;
        return [...prev, { agentId: agent.id, agentName: agent.name }];
      });
    },
    [agents],
  );

  const {
    isOpen: mentionOpen,
    query: mentionQuery,
    position: mentionPosition,
    selectedIndex: mentionIndex,
    filteredItems: mentionFiltered,
    handleInput: mentionHandleInput,
    handleKeyDown: mentionHandleKeyDown,
    closeMention,
  } = useMention({ agents, items: mentionItems, onSelectAgent });

  const handleSend = useCallback(async () => {
    const trimmed = trimForSend(value);
    if (trimmed === null) return;
    const currentMentions = mentionedAgents.length > 0 ? [...mentionedAgents] : undefined;
    const accepted = await onSend(trimmed, currentMentions);
    if (accepted === false) return;
    setValue('');
    setMentionedAgents([]);
    const ta = textareaRef.current;
    if (ta) clearTextarea(ta);
  }, [value, mentionedAgents, onSend, trimForSend, clearTextarea]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // If mention popover is open, let mention handle keyboard navigation
      if (mentionOpen) {
        const consumed = mentionHandleKeyDown(e);
        if (consumed) return;
      }
      handleEnterKey(e, handleSend);
    },
    [handleSend, mentionOpen, mentionHandleKeyDown, handleEnterKey],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      autoResize(e.target);
      mentionHandleInput();
    },
    [mentionHandleInput, autoResize],
  );

  const overLimit = value.length > MAX_CHARS;
  const sendDisabled = disabled || value.trim().length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            aria-label="Message input"
          />
          {mentionedAgents.length > 0 && (
            <div className={styles.mentionChips}>
              {mentionedAgents.map((m) => (
                <span key={m.agentId} className={styles.mentionChip}>
                  @{m.agentName}
                  <button
                    type="button"
                    className={styles.mentionChipRemove}
                    onClick={() =>
                      setMentionedAgents((prev) => prev.filter((p) => p.agentId !== m.agentId))
                    }
                    aria-label={`Remove ${m.agentName} mention`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={styles.footer}>
            <span className={styles.hint}>
              <kbd>Enter</kbd> to send
              {agents.length > 0 && <> &middot; <kbd>@</kbd> to mention</>}
            </span>
            <span className={`${styles.charCount} ${overLimit ? styles.charCountOver : ''}`}>
              {value.length}/{MAX_CHARS}
            </span>
          </div>
        </div>

        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={sendDisabled}
          aria-label="Send message"
          title="Send message"
        >
          <Send size={16} />
        </button>
      </div>

      {/* Mention popover */}
      <MentionPopover
        agents={agents}
        items={mentionFiltered}
        isOpen={mentionOpen}
        query={mentionQuery}
        position={mentionPosition}
        selectedIndex={mentionIndex}
        onSelect={(item) => {
          if (item.kind === 'agent' && item.agent) {
            onSelectAgent(item.agent.id);
          }
        }}
        onClose={closeMention}
      />
    </div>
  );
});

export default IMMessageInput;
