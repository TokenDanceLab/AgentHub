import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, Plus, Square, ArrowUp, LoaderCircle } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import { useInputDraft } from '@/hooks/useInputDraft';
import { useMention } from '@/hooks/useMention';
import MentionPopover from '@/components/MentionPopover';
import ModelReasoningPicker from '@/components/ModelReasoningPicker';
import PermissionModePicker from '@/components/PermissionModePicker';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import { useShallow } from 'zustand/shallow';
import styles from './PromptInput.module.css';

const COMMON_MODELS = [
  'claude-opus-4-7', 'claude-opus-4-5',
  'claude-sonnet-4-6', 'claude-haiku-4-5',
];

const REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions', 'dontAsk'] as const;
type PermissionMode = (typeof PERMISSION_MODES)[number];

interface SendOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode?: PermissionMode;
  workDir?: string;
}

interface Props {
  agents: AgentInfo[];
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onSend: (prompt: string, agentId?: string, opts?: SendOptions) => boolean | void | Promise<boolean | void>;
  isStreaming?: boolean;
  isStarting?: boolean;
  onCancel?: () => void;
  disabled?: boolean;
  threadId?: string;
}

export default function PromptInput({
  agents, selectedAgentId, onSelectAgent, onSend,
  isStreaming = false, isStarting = false, onCancel, disabled, threadId,
}: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [promptLength, setPromptLength] = useState(0);
  const [model, setModel] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [workDir, setWorkDir] = useState('');
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const selectedAgentAlias = preferredProfileAlias(selectedAgent);
  const routeModel = model || selectedAgentAlias || undefined;
  const modelSettings = useModelSettingsStore(
    useShallow((s) => ({
      defaultModel: s.defaultModel,
      defaultProvider: s.defaultProvider,
      defaultReasoningEffort: s.reasoningEffort,
      providerFallbackEnabled: s.providerFallbackEnabled,
      modelMappingEnabled: s.modelMappingEnabled,
      aliases: s.aliases,
      resolveRunRequestOptions: s.resolveRunRequestOptions,
    })),
  );
  const resolvedRoute = useMemo(
    () => modelSettings.resolveRunRequestOptions({
      model: routeModel,
      reasoningEffort: reasoningEffort || undefined,
    }),
    [
      model,
      modelSettings.aliases,
      modelSettings.defaultModel,
      modelSettings.defaultProvider,
      modelSettings.defaultReasoningEffort,
      modelSettings.modelMappingEnabled,
      modelSettings.providerFallbackEnabled,
      modelSettings.resolveRunRequestOptions,
      reasoningEffort,
      routeModel,
    ],
  );

  const {
    isOpen: mentionOpen, query: mentionQuery, position: mentionPosition,
    selectedIndex: mentionIndex, filteredAgents: mentionFiltered,
    handleInput: mentionHandleInput, handleKeyDown: mentionHandleKeyDown,
    selectAgent: mentionSelectAgent, closeMention,
  } = useMention({ agents, onSelectAgent });

  const { restore: restoreDraft, save: saveDraft, flush: flushDraft, clear: clearDraft } = useInputDraft(threadId);

  useEffect(() => {
    try {
      setWorkDir(window.localStorage.getItem('agenthub.prompt.workDir') ?? '');
      const savedMode = window.localStorage.getItem('agenthub.prompt.permissionMode');
      if (savedMode && PERMISSION_MODES.includes(savedMode as PermissionMode)) {
        setPermissionMode(savedMode as PermissionMode);
      }
    } catch {
      // localStorage can be unavailable in tests.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('agenthub.prompt.workDir', workDir);
      window.localStorage.setItem('agenthub.prompt.permissionMode', permissionMode);
    } catch {
      // Ignore persistence failures; the controls still apply to the current run.
    }
  }, [permissionMode, workDir]);

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

  const handleSend = useCallback(async () => {
    const ta = inputRef.current;
    if (!ta) return;
    const trimmed = ta.value.trim();
    if (!trimmed || disabled || isStreaming || isStarting) return;
    const opts: SendOptions = {};
    if (model || selectedAgentAlias) opts.model = model || selectedAgentAlias;
    if (reasoningEffort) opts.reasoningEffort = reasoningEffort;
    if (permissionMode !== 'default') opts.permissionMode = permissionMode;
    if (workDir.trim()) opts.workDir = workDir.trim();
    const accepted = await onSend(
      trimmed,
      selectedAgentId,
      opts.model || opts.reasoningEffort || opts.permissionMode || opts.workDir ? opts : undefined,
    );
    if (accepted === false) return;
    ta.value = '';
    ta.style.height = 'auto';
    setPromptLength(0);
    closeMention();
    clearDraft();
  }, [disabled, isStreaming, isStarting, selectedAgentId, model, selectedAgentAlias, reasoningEffort, permissionMode, workDir, onSend, clearDraft, closeMention]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mentionHandleKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend, mentionHandleKeyDown]);

  const placeholder = selectedAgent
    ? `${t('prompt.placeholder')} @${selectedAgent.name}...`
    : t('prompt.placeholder');
  const providerLabel = resolvedRoute.provider === 'tokendance-relay'
    ? 'TokenDance'
    : (resolvedRoute.provider ?? t('prompt.routeAuto'));
  const permissionLabel = t(`prompt.permission.${permissionMode}`);
  const effectiveReasoning = reasoningEffort || (resolvedRoute.reasoningEffort as ReasoningEffort | undefined) || 'high';
  const modelPickerOptions = COMMON_MODELS.map((m) => ({
    value: m,
    label: m,
    provider: providerLabel,
  }));

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
          disabled={disabled || isStarting || isStreaming}
          rows={1}
        />

        {/* bottom action bar */}
        <div className={styles.actions}>
          <div className={styles.leftGroup}>
            <button
              type="button"
              className={styles.attachBtn}
              disabled={disabled || isStarting}
              title={t('prompt.attachCustom')}
              aria-label={t('prompt.attachCustom')}
            >
              <Plus size={16} strokeWidth={2.2} />
            </button>
            <PermissionModePicker
              value={permissionMode}
              label={permissionLabel}
              options={PERMISSION_MODES.map((mode) => ({ value: mode, label: t(`prompt.permission.${mode}`) }))}
              disabled={disabled || isStarting}
              ariaLabel={t('prompt.permissionMode')}
              onChange={(value) => setPermissionMode(value as PermissionMode)}
            />
          </div>

          <div className={styles.rightGroup}>
            <div className={styles.routePreview} aria-label={t('prompt.routePreview')}>
              <span className={styles.providerPill}>
                {providerLabel}
              </span>
            </div>
            <div className={styles.metaChain}>
              <ModelReasoningPicker
                models={modelPickerOptions}
                modelValue={resolvedRoute.model ?? model}
                modelLabel={resolvedRoute.model ?? t('prompt.model')}
                reasoningValue={effectiveReasoning}
                reasoningLabel={t(`prompt.reasoning.${effectiveReasoning}`)}
                reasoningOptions={REASONING_EFFORTS.map((r) => ({ value: r, label: t(`prompt.reasoning.${r}`) }))}
                disabled={disabled || isStarting}
                ariaLabel={t('prompt.modelReasoning')}
                onModelChange={setModel}
                onReasoningChange={(v) => setReasoningEffort(v as ReasoningEffort)}
              />
          </div>

          {isStarting ? (
            <button className={styles.sendBtn} disabled aria-label={t('prompt.starting')}>
              <LoaderCircle size={16} strokeWidth={2.2} className={styles.spinner} />
            </button>
          ) : isStreaming ? (
            <button className={styles.stopBtn} onClick={onCancel} disabled={disabled} aria-label={t('action.cancelRun')}>
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              className={`${styles.sendBtn} ${promptLength > 0 ? styles.sendBtnActive : ''}`}
              onClick={() => void handleSend()} disabled={disabled || promptLength === 0}
              aria-label={t('action.startRun')}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
