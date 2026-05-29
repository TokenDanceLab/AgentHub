import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Clock3, FileText, FolderOpen, HardDrive, Plus, Server, Square, ArrowUp, LoaderCircle, X } from 'lucide-react';
import type { AgentInfo, ThreadInfo } from '@shared/types';
import type { ExecutionTargetInventoryItem } from '@/api/executionTargetQueries';
import { useInputDraft } from '@/hooks/useInputDraft';
import { useMention, type MentionItem } from '@/hooks/useMention';
import MentionPopover from '@/components/MentionPopover';
import ModelReasoningPicker from '@/components/ModelReasoningPicker';
import type { ModelReasoningOption } from '@/components/ModelReasoningPicker';
import PermissionModePicker from '@/components/PermissionModePicker';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import type { ModelCatalogItem, ModelCatalogResponse } from '@/api/modelCatalogQueries';
import {
  normalizeModelIdForLookup,
  resolveModelDisplayName,
  type ModelDisplayNameMap,
} from '@/utils/modelDisplay';
import { useShallow } from 'zustand/shallow';
import styles from './PromptInput.module.css';

const REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions', 'dontAsk'] as const;
type PermissionMode = (typeof PERMISSION_MODES)[number];
const MAX_BROWSER_ATTACHMENT_PREVIEW = 12_000;
const WORK_DIR_STORAGE_KEY = 'agenthub.prompt.workDir';
const RECENT_WORK_DIRS_STORAGE_KEY = 'agenthub.prompt.recentWorkDirs';
const MAX_RECENT_WORK_DIRS = 6;

interface SendOptions {
  model?: string;
  provider?: string;
  modelAlias?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode?: PermissionMode;
  workDir?: string;
}

interface SelectedCatalogRoute {
  optionId?: string;
  value: string;
  requestModel: string;
  provider?: string;
  modelAlias?: string;
}

interface PromptAttachment {
  id: string;
  name: string;
  source: 'desktop' | 'browser';
  path?: string;
  size?: number;
  mime?: string;
  contentPreview?: string;
  truncated?: boolean;
}

interface SlashCommand {
  id: string;
  group: string;
  label: string;
  description: string;
  keywords: string[];
  run: () => void;
}

const MAX_SLASH_MODEL_OPTIONS = 8;

interface Props {
  agents: AgentInfo[];
  threads?: ThreadInfo[];
  executionTargets?: ExecutionTargetInventoryItem[];
  modelCatalog?: ModelCatalogResponse;
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onSend: (prompt: string, agentId?: string, opts?: SendOptions) => boolean | void | Promise<boolean | void>;
  isStreaming?: boolean;
  isStarting?: boolean;
  onCancel?: () => void;
  disabled?: boolean;
  threadId?: string;
  modelDisplayNames?: ModelDisplayNameMap;
  onRetryLast?: () => void | Promise<void>;
  onForkThread?: () => void | Promise<void>;
}

function parseSlashCommandAtCursor(value: string, cursorPos: number): { query: string; startIndex: number } | null {
  const lineStart = value.lastIndexOf('\n', Math.max(0, cursorPos - 1)) + 1;
  const textBeforeCursor = value.slice(lineStart, cursorPos);
  if (!textBeforeCursor.startsWith('/')) return null;
  const query = textBeforeCursor.slice(1);
  if (/\s/.test(query)) return null;
  return { query, startIndex: lineStart };
}

function commandIdFragment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'item';
}

function slashCommandMatches(command: SlashCommand, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    command.id,
    command.group,
    command.label,
    command.description,
    ...command.keywords,
  ].join(' ').toLowerCase();
  return normalized.split(/\s+/).every((part) => haystack.includes(part));
}

function compactPathLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function pathBasename(value: string): string {
  return value.split(/[\\/]+/).filter(Boolean).pop() ?? value;
}

function normalizeWorkDir(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

function sameWorkDir(a: string, b: string): boolean {
  return normalizeWorkDir(a).toLowerCase() === normalizeWorkDir(b).toLowerCase();
}

function pushRecentWorkDir(items: string[], value: string): string[] {
  const normalized = normalizeWorkDir(value);
  if (!normalized) return items;
  return [
    normalized,
    ...items.map(normalizeWorkDir).filter((item) => item && !sameWorkDir(item, normalized)),
  ].slice(0, MAX_RECENT_WORK_DIRS);
}

function readRecentWorkDirs(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_WORK_DIRS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeWorkDir)
      .filter(Boolean)
      .slice(0, MAX_RECENT_WORK_DIRS);
  } catch {
    return [];
  }
}

function persistRecentWorkDirs(items: string[]): void {
  try {
    window.localStorage.setItem(RECENT_WORK_DIRS_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore persistence failures; the current selection still applies.
  }
}

function formatBytes(value: number | undefined): string | undefined {
  if (value == null) return undefined;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function shouldPreviewBrowserFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(txt|md|markdown|json|jsonl|csv|tsv|yaml|yml|toml|xml|html|css|scss|js|jsx|ts|tsx|go|rs|py|java|c|cpp|h|hpp|log)$/i.test(file.name);
}

function formatAttachmentContext(attachments: PromptAttachment[]): string {
  if (attachments.length === 0) return '';
  const lines = ['Attached files:'];
  attachments.forEach((attachment, index) => {
    lines.push(`${index + 1}. ${attachment.name}`);
    if (attachment.path) lines.push(`   Path: ${attachment.path}`);
    lines.push(`   Source: ${attachment.source === 'desktop' ? 'Desktop file picker' : 'Browser file picker'}`);
    const size = formatBytes(attachment.size);
    if (size) lines.push(`   Size: ${size}`);
    if (attachment.mime) lines.push(`   MIME: ${attachment.mime}`);
    if (attachment.contentPreview) {
      lines.push(`   Content preview${attachment.truncated ? ' (truncated)' : ''}:`);
      lines.push(attachment.contentPreview.split(/\r?\n/).map((line) => `   ${line}`).join('\n'));
    }
  });
  return lines.join('\n');
}

async function browserFilesToAttachments(files: File[]): Promise<PromptAttachment[]> {
  return Promise.all(files.map(async (file, index) => {
    let contentPreview: string | undefined;
    let truncated = false;
    if (shouldPreviewBrowserFile(file) && typeof file.text === 'function') {
      try {
        const text = await file.text();
        contentPreview = text.slice(0, MAX_BROWSER_ATTACHMENT_PREVIEW);
        truncated = text.length > MAX_BROWSER_ATTACHMENT_PREVIEW;
      } catch {
        contentPreview = undefined;
      }
    }
    return {
      id: `browser-${Date.now()}-${index}-${file.name}`,
      name: file.name,
      source: 'browser' as const,
      size: file.size,
      mime: file.type || undefined,
      contentPreview,
      truncated,
    };
  }));
}

async function pickDesktopAttachments(): Promise<PromptAttachment[] | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: true, directory: false });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    return paths
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .map((path, index) => ({
        id: `desktop-${Date.now()}-${index}-${path}`,
        name: pathBasename(path),
        source: 'desktop' as const,
        path,
      }));
  } catch {
    return null;
  }
}

async function pickDesktopWorkDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const selected = await (await import('@tauri-apps/plugin-dialog')).open({ directory: true, multiple: false });
    if (!selected) return null;
    if (Array.isArray(selected)) return typeof selected[0] === 'string' ? selected[0] : null;
    return typeof selected === 'string' ? selected : null;
  } catch {
    return null;
  }
}

function targetWorkspaceRoot(target: ExecutionTargetInventoryItem): string {
  return target.workspace_root?.trim() || target.workspace_allowlist[0]?.trim() || '';
}

function isSelectableLocalTarget(target: ExecutionTargetInventoryItem): boolean {
  return (
    target.target_type === 'local_edge'
    && target.is_online
    && target.health_state !== 'offline'
    && Boolean(targetWorkspaceRoot(target))
  );
}

function isRegisteredLocalTarget(target: ExecutionTargetInventoryItem): boolean {
  return target.target_type === 'local_edge';
}

function directTargetUnavailableReason(target: ExecutionTargetInventoryItem, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!targetWorkspaceRoot(target)) return t('prompt.targetNoWorkspace');
  if (!target.is_online || target.health_state === 'offline') return t('prompt.targetLocalOffline');
  return t('prompt.targetRemoteDisabled', { type: target.target_type });
}

function targetTrustLabel(target: ExecutionTargetInventoryItem, t: (key: string, vars?: Record<string, unknown>) => string): string {
  return t(`prompt.targetTrust.${target.trust_level}`);
}

function agentRuntimeTokens(agent?: AgentInfo): string[] {
  if (!agent) return [];
  const raw = [agent.runtimeId, agent.id, agent.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (raw.includes('orchestrator')) return ['orchestrator', 'claude-code'];
  if (raw.includes('claude')) return ['claude-code'];
  if (raw.includes('codex')) return ['codex'];
  if (raw.includes('opencode') || raw.includes('open-code')) return ['opencode'];
  return [agent.runtimeId, agent.id]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
}

function isCatalogItemForAgent(item: ModelCatalogItem, agent?: AgentInfo): boolean {
  const allowedRuntimes = agentRuntimeTokens(agent);
  if (allowedRuntimes.length === 0) return true;
  const itemRuntime = item.runtimeId?.toLowerCase() ?? '';
  if (!itemRuntime) return true;
  return allowedRuntimes.includes(itemRuntime);
}

function normalizedModelKey(value: string | undefined, modelDisplayNames?: ModelDisplayNameMap): string {
  return resolveModelDisplayName(value, modelDisplayNames)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeModelId(value: string | undefined, modelDisplayNames?: ModelDisplayNameMap): boolean {
  const normalized = resolveModelDisplayName(value, modelDisplayNames).toLowerCase();
  if (!normalized) return false;
  if (/^(main|subagent|opus|sonnet|haiku|default|auto)$/i.test(normalized)) return false;
  if (/^(opus|sonnet|haiku)\s*1m$/i.test(normalized)) return false;
  if (/\b(settings|provider|route|mapping|default|config|runtime|orchestrator|direct|local|edge)\b/i.test(normalized)) return false;
  return (
    /\b(gpt|claude|deepseek|glm|kimi|mimo|minimax|qwen|doubao|gemini|mistral|llama|moonshot|openai)\b[-\w./ ]*\d/i.test(normalized)
    || /\bo[1345](?:[-.\w]*|\b)/i.test(normalized)
  );
}

function catalogDisplayModel(item: ModelCatalogItem, modelDisplayNames?: ModelDisplayNameMap): string {
  const label = item.label?.trim();
  const resolved = item.resolvedModel?.trim();
  const value = item.value?.trim();

  if (looksLikeModelId(label, modelDisplayNames)) return resolveModelDisplayName(label, modelDisplayNames);
  if (looksLikeModelId(resolved, modelDisplayNames)) return resolveModelDisplayName(resolved, modelDisplayNames);
  if (looksLikeModelId(value, modelDisplayNames)) return resolveModelDisplayName(value, modelDisplayNames);
  return resolveModelDisplayName(label || resolved || value, modelDisplayNames);
}

function catalogRequestModel(item: ModelCatalogItem): string {
  return item.resolvedModel?.trim() || item.value.trim();
}

function displayProviderName(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes('tokendance') || lower.includes('newapi') || lower.includes('api.vectorcontrol.tech')) {
    return 'TokenDance';
  }
  return raw;
}

function catalogRouteKind(item: ModelCatalogItem): ModelReasoningOption['routeKind'] {
  if (item.sourceId === 'codex-config' || item.sourceId === 'claude-settings') return 'config';
  if (item.sourceId === 'claude-provider-map') return 'mapping';
  if (item.sourceId === 'edge-adapter' || item.default) return 'default';
  return 'direct';
}

function catalogRouteLabel(item: ModelCatalogItem): string {
  const runtime = item.runtimeId?.toLowerCase();
  switch (item.sourceId) {
    case 'codex-config':
      return 'Config';
    case 'claude-settings':
      return 'Settings';
    case 'claude-provider-map':
      return 'Map';
    case 'edge-adapter':
      if (runtime === 'claude-code') return 'Claude';
      if (runtime === 'orchestrator') return 'Team';
      if (runtime === 'codex') return 'Codex';
      if (runtime === 'opencode') return 'OpenCode';
      return 'Runtime';
    default:
      return displayProviderName(item.sourceLabel) || item.runtimeId || '';
  }
}

function visibleModelOptionKey(item: ModelReasoningOption, modelDisplayNames?: ModelDisplayNameMap): string {
  const displayModel = normalizeModelIdForLookup(resolveModelDisplayName(item.label || item.resolvedModel || item.requestModel || item.value, modelDisplayNames));
  const provider = item.provider?.trim().toLowerCase() ?? '';
  const providerVisible = provider && !['tokendance', 'claude code', 'codex', 'opencode', 'claude-code'].includes(provider);
  const providerKey = providerVisible ? (item.providerId || normalizedProviderId(item.provider) || provider) : 'primary';
  return `${providerKey}::${displayModel}`;
}

function uniqueModelOptions(items: ModelReasoningOption[], modelDisplayNames?: ModelDisplayNameMap, preferredRuntimeId?: string): ModelReasoningOption[] {
  const byKey = new Map<string, ModelReasoningOption>();
  for (const item of items) {
    const key = visibleModelOptionKey(item, modelDisplayNames);
    const current = byKey.get(key);
    if (!current || compareModelRoutePriority(item, current, preferredRuntimeId) < 0) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

function compareModelRoutePriority(a: ModelReasoningOption, b: ModelReasoningOption, preferredRuntimeId?: string): number {
  const priority = modelRoutePriority(a) - modelRoutePriority(b);
  if (priority !== 0) return priority;
  if (preferredRuntimeId) {
    const runtimePriority = (a.runtimeId === preferredRuntimeId ? 0 : 1) - (b.runtimeId === preferredRuntimeId ? 0 : 1);
    if (runtimePriority !== 0) return runtimePriority;
  }
  return String(a.id ?? a.value).localeCompare(String(b.id ?? b.value));
}

function modelRoutePriority(item: ModelReasoningOption): number {
  if (item.default && item.routeKind !== 'default') return 0;
  if (item.routeKind === 'config') return 1;
  if (item.routeKind === 'mapping') return 2;
  if (item.default || item.routeKind === 'default') return 3;
  return 4;
}

function normalizedProviderId(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes('tokendance') || lower.includes('newapi') || lower.includes('api.vectorcontrol.tech')) {
    return 'tokendance-gateway';
  }
  return lower
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || undefined;
}

function catalogRequestProvider(item: ModelCatalogItem): string | undefined {
  const model = catalogRequestModel(item);
  const providerHint = `${item.provider ?? ''} ${item.sourceLabel} ${model}`;
  const provider = normalizedProviderId(providerHint);
  if (provider === 'tokendance-gateway') return provider;
  if (item.runtimeId === 'claude-code' || item.sourceId.startsWith('claude-')) return 'claude-code';
  if (item.runtimeId === 'codex') return provider ?? 'codex';
  if (item.runtimeId === 'opencode') {
    if (model.includes('/')) return normalizedProviderId(model.split('/')[0]);
    return provider ?? 'opencode';
  }
  return provider ?? item.runtimeId;
}

function catalogDisplayProvider(item: ModelCatalogItem): string | undefined {
  const provider = catalogRequestProvider(item);
  if (provider === 'tokendance-gateway') return 'TokenDance';
  return displayProviderName(item.provider || item.sourceLabel);
}

function catalogModelAlias(item: ModelCatalogItem): string | undefined {
  const resolved = item.resolvedModel?.trim();
  const value = item.value.trim();
  if (!resolved || resolved === value) return undefined;
  return value;
}

function findSelectedModelOption(
  options: ModelReasoningOption[],
  selectedRoute: SelectedCatalogRoute | null,
  model: string,
  resolvedModel: string | undefined,
  modelDisplayNames?: ModelDisplayNameMap,
): ModelReasoningOption | undefined {
  if (selectedRoute?.optionId) {
    const exact = options.find((item) => item.id === selectedRoute.optionId);
    if (exact) return exact;
  }
  const candidates = [model, selectedRoute?.value, selectedRoute?.requestModel, resolvedModel]
    .filter((value): value is string => Boolean(value?.trim()));
  for (const candidate of candidates) {
    const exact = options.find((item) => item.value === candidate || item.requestModel === candidate || item.resolvedModel === candidate);
    if (exact) return exact;
    const candidateKey = normalizedModelKey(candidate, modelDisplayNames);
    const byLabel = options.find((item) => normalizedModelKey(item.label, modelDisplayNames) === candidateKey);
    if (byLabel) return byLabel;
  }
  return options.find((item) => item.default) ?? options[0];
}

function compactThreadTitle(thread: ThreadInfo): string {
  return (thread.title || thread.threadId).replace(/\s+/g, ' ').trim();
}

function threadMentionReplacement(thread: ThreadInfo): string {
  const title = compactThreadTitle(thread).replace(/[()]/g, '');
  return `@thread(${title} ${thread.threadId})`;
}

export default function PromptInput({
  agents, threads = [], executionTargets = [], modelCatalog, selectedAgentId, onSelectAgent, onSend,
  isStreaming = false, isStarting = false, onCancel, disabled, threadId, modelDisplayNames, onRetryLast, onForkThread,
}: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const workTargetRef = useRef<HTMLDivElement>(null);
  const [promptLength, setPromptLength] = useState(0);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [model, setModel] = useState<string>('');
  const [selectedCatalogRoute, setSelectedCatalogRoute] = useState<SelectedCatalogRoute | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [workDir, setWorkDir] = useState('');
  const [workDirDraft, setWorkDirDraft] = useState('');
  const [recentWorkDirs, setRecentWorkDirs] = useState<string[]>([]);
  const [workTargetOpen, setWorkTargetOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const desktopRuntimeAvailable = isTauriRuntime();
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

  const { restore: restoreDraft, save: saveDraft, flush: flushDraft, clear: clearDraft } = useInputDraft(threadId);

  const rememberWorkDir = useCallback((value: string) => {
    const normalized = normalizeWorkDir(value);
    if (!normalized) return;
    setRecentWorkDirs((prev) => {
      const next = pushRecentWorkDir(prev, normalized);
      persistRecentWorkDirs(next);
      return next;
    });
  }, []);

  const applyWorkDir = useCallback((value: string, options: { closeMenu?: boolean } = {}) => {
    const normalized = normalizeWorkDir(value);
    setWorkDir(normalized);
    setWorkDirDraft(normalized);
    if (normalized) rememberWorkDir(normalized);
    if (options.closeMenu) setWorkTargetOpen(false);
  }, [rememberWorkDir]);

  const clearRecentWorkDirs = useCallback(() => {
    setRecentWorkDirs([]);
    try {
      window.localStorage.removeItem(RECENT_WORK_DIRS_STORAGE_KEY);
    } catch {
      // localStorage can be unavailable in tests.
    }
  }, []);

  const writeTextareaValue = useCallback((value: string, cursorPos = value.length) => {
    const ta = inputRef.current;
    if (!ta) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(ta, value);
    } else {
      ta.value = value;
    }
    ta.selectionStart = ta.selectionEnd = Math.max(0, Math.min(cursorPos, value.length));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  const closeSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery('');
    setSlashIndex(0);
  }, []);

  const handleAttach = useCallback(async () => {
    if (disabled || isStarting) return;
    const desktopAttachments = await pickDesktopAttachments();
    if (desktopAttachments && desktopAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...desktopAttachments]);
      return;
    }
    if (desktopAttachments === null) {
      attachmentInputRef.current?.click();
    }
  }, [disabled, isStarting]);

  const mentionItems = useMemo<MentionItem[]>(() => {
    const agentItems: MentionItem[] = agents.map((agent) => ({
      id: `agent:${agent.id}`,
      kind: 'agent',
      label: agent.name,
      description: agent.description || t('prompt.mention.agentDesc'),
      status: agent.status,
      keywords: [agent.id, agent.name, 'agent', 'runtime'],
      replacementText: '',
      agent,
    }));
    const fileItem: MentionItem = {
      id: 'file:attach',
      kind: 'file',
      label: t('prompt.mention.attachFile'),
      description: desktopRuntimeAvailable ? t('prompt.mention.attachFileDesc') : t('prompt.mention.attachFileBrowserDesc'),
      keywords: ['file', 'attach', 'attachment', t('prompt.mention.attachFile')],
      replacementText: '',
    };
    const threadItems: MentionItem[] = threads.slice(0, 12).map((thread) => {
      const title = compactThreadTitle(thread);
      return {
        id: `thread:${thread.threadId}`,
        kind: 'thread',
        label: title,
        description: t('prompt.mention.threadDesc', { id: thread.threadId }),
        keywords: ['thread', 'session', title, thread.threadId],
        replacementText: threadMentionReplacement(thread),
        payload: thread,
      };
    });
    return [...agentItems, fileItem, ...threadItems];
  }, [agents, desktopRuntimeAvailable, t, threads]);

  const handleMentionSelected = useCallback((item: MentionItem) => {
    if (item.kind === 'file') {
      void handleAttach();
    }
  }, [handleAttach]);

  const {
    isOpen: mentionOpen, query: mentionQuery, position: mentionPosition,
    selectedIndex: mentionIndex, filteredItems: mentionFiltered,
    handleInput: mentionHandleInput, handleKeyDown: mentionHandleKeyDown,
    selectItem: mentionSelectItem, closeMention,
  } = useMention({ agents, items: mentionItems, onSelectAgent, onSelectMention: handleMentionSelected });

  const clearComposer = useCallback(() => {
    const ta = inputRef.current;
    if (ta) {
      ta.value = '';
      ta.style.height = 'auto';
      ta.focus();
    }
    setPromptLength(0);
    setAttachments([]);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    clearDraft();
    closeMention();
    closeSlash();
  }, [clearDraft, closeMention, closeSlash]);

  const removeSlashTrigger = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const parsed = parseSlashCommandAtCursor(ta.value, cursor);
    if (!parsed) return;
    const before = ta.value.slice(0, parsed.startIndex);
    const after = ta.value.slice(cursor);
    const needsSpace = before.length > 0 && after.length > 0 && !/\s$/.test(before) && !/^\s/.test(after);
    const nextValue = `${before}${needsSpace ? ' ' : ''}${after}`;
    const nextCursor = before.length + (needsSpace ? 1 : 0);
    writeTextareaValue(nextValue, nextCursor);
  }, [writeTextareaValue]);

  useEffect(() => {
    try {
      const savedWorkDir = normalizeWorkDir(window.localStorage.getItem(WORK_DIR_STORAGE_KEY) ?? '');
      const savedRecent = readRecentWorkDirs();
      setWorkDir(savedWorkDir);
      setWorkDirDraft(savedWorkDir);
      setRecentWorkDirs(savedWorkDir ? pushRecentWorkDir(savedRecent, savedWorkDir) : savedRecent);
      const savedMode = window.localStorage.getItem('agenthub.prompt.permissionMode');
      if (savedMode && PERMISSION_MODES.includes(savedMode as PermissionMode)) {
        setPermissionMode(savedMode as PermissionMode);
      }
    } catch {
      // localStorage can be unavailable in tests.
    }
  }, []);

  useEffect(() => {
    const handleWorkDirSelected = (event: Event) => {
      const nextWorkDir = normalizeWorkDir((event as CustomEvent<{ workDir?: string }>).detail?.workDir);
      if (!nextWorkDir) return;
      applyWorkDir(nextWorkDir);
    };
    const handleSetComposerDraft = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      const nextText = detail?.text ?? '';
      if (!nextText.trim()) return;
      clearDraft();
      setAttachments([]);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      closeMention();
      closeSlash();
      writeTextareaValue(nextText);
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => inputRef.current?.focus(), 120);
    };
    const handleFocusComposer = () => {
      const input = inputRef.current;
      if (!input) return;
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => input.focus(), 120);
    };
    window.addEventListener('agenthub:workdir-selected', handleWorkDirSelected);
    window.addEventListener('agenthub:set-composer-draft', handleSetComposerDraft);
    window.addEventListener('agenthub:focus-composer', handleFocusComposer);
    return () => {
      window.removeEventListener('agenthub:workdir-selected', handleWorkDirSelected);
      window.removeEventListener('agenthub:set-composer-draft', handleSetComposerDraft);
      window.removeEventListener('agenthub:focus-composer', handleFocusComposer);
    };
  }, [applyWorkDir, clearDraft, closeMention, closeSlash, writeTextareaValue]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORK_DIR_STORAGE_KEY, workDir);
      window.localStorage.setItem('agenthub.prompt.permissionMode', permissionMode);
    } catch {
      // Ignore persistence failures; the controls still apply to the current run.
    }
  }, [permissionMode, workDir]);

  useEffect(() => {
    if (!workTargetOpen) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && workTargetRef.current?.contains(target)) return;
      setWorkTargetOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWorkTargetOpen(false);
    };
    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [workTargetOpen]);

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
      const slash = parseSlashCommandAtCursor(ta.value, ta.selectionStart);
      if (slash) {
        setSlashQuery(slash.query);
        setSlashOpen(true);
        setSlashIndex(0);
        closeMention();
        return;
      }
      closeSlash();
      mentionHandleInput();
    };
    ta.addEventListener('input', handleUpdate);
    return () => ta.removeEventListener('input', handleUpdate);
  }, [closeMention, closeSlash, mentionHandleInput, saveDraft]);

  const handleSend = useCallback(async () => {
    const ta = inputRef.current;
    if (!ta) return;
    const trimmed = ta.value.trim();
    if (!trimmed || disabled || isStreaming || isStarting) return;
    const opts: SendOptions = {};
    const selectedRoute = selectedCatalogRoute?.value === model ? selectedCatalogRoute : null;
    if (selectedRoute) {
      opts.model = selectedRoute.requestModel;
      if (selectedRoute.provider) opts.provider = selectedRoute.provider;
      if (selectedRoute.modelAlias) opts.modelAlias = selectedRoute.modelAlias;
    } else if (model || selectedAgentAlias) {
      opts.model = model || selectedAgentAlias;
    }
    if (reasoningEffort) opts.reasoningEffort = reasoningEffort;
    if (permissionMode !== 'default') opts.permissionMode = permissionMode;
    if (workDir.trim()) {
      opts.workDir = workDir.trim();
      rememberWorkDir(workDir);
    }
    const attachmentContext = formatAttachmentContext(attachments);
    const promptWithAttachments = attachmentContext ? `${trimmed}\n\n${attachmentContext}` : trimmed;
    const accepted = await onSend(
      promptWithAttachments,
      selectedAgentId,
      opts.model || opts.provider || opts.modelAlias || opts.reasoningEffort || opts.permissionMode || opts.workDir ? opts : undefined,
    );
    if (accepted === false) return;
    ta.value = '';
    ta.style.height = 'auto';
    setPromptLength(0);
    closeMention();
    clearDraft();
    setAttachments([]);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }, [attachments, disabled, isStreaming, isStarting, selectedAgentId, model, selectedAgentAlias, selectedCatalogRoute, reasoningEffort, permissionMode, workDir, onSend, clearDraft, closeMention, rememberWorkDir]);

  const handleBrowseWorkDir = useCallback(async () => {
    if (disabled || isStarting) return;
    const selected = await pickDesktopWorkDir();
    if (!selected) return;
    applyWorkDir(selected, { closeMenu: true });
  }, [applyWorkDir, disabled, isStarting]);

  const handleBrowserAttachmentChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const nextAttachments = await browserFilesToAttachments(files);
    setAttachments((prev) => [...prev, ...nextAttachments]);
    input.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const placeholder = selectedAgent
    ? `${t('prompt.placeholder')} @${selectedAgent.name}...`
    : t('prompt.placeholder');
  const permissionLabel = t(`prompt.permission.${permissionMode}`);
  const effectiveReasoning = reasoningEffort || (resolvedRoute.reasoningEffort as ReasoningEffort | undefined) || 'high';
  const directTargets = executionTargets.filter(isSelectableLocalTarget);
  const unavailableLocalTargets = executionTargets.filter((target) => isRegisteredLocalTarget(target) && !isSelectableLocalTarget(target));
  const remoteInventoryTargets = executionTargets.filter((target) => target.target_type !== 'local_edge');
  const recentWorkDirOptions = recentWorkDirs.filter((path) => (
    path && !directTargets.some((target) => sameWorkDir(targetWorkspaceRoot(target), path))
  ));
  const workTargetLabel = workDir.trim()
    ? compactPathLabel(workDir)
    : t('prompt.targetLocalEdge');
  const modelPickerOptions = useMemo(() => {
    const catalogOptions = (modelCatalog?.items ?? [])
      .filter((item) => item.status !== 'unavailable')
      .filter((item) => isCatalogItemForAgent(item, selectedAgent))
      .map((item) => ({
        id: item.id,
        value: item.value,
        label: catalogDisplayModel(item, modelDisplayNames),
        provider: catalogDisplayProvider(item),
        providerId: catalogRequestProvider(item),
        requestModel: catalogRequestModel(item),
        modelAlias: catalogModelAlias(item),
        source: item.sourceLabel,
        sourceId: item.sourceId,
        routeKind: catalogRouteKind(item),
        routeLabel: catalogRouteLabel(item),
        runtimeId: item.runtimeId,
        resolvedModel: item.resolvedModel,
        description: item.description,
        status: item.status,
        default: item.default,
      }));
    const fallbackModel = resolvedRoute.model ?? routeModel ?? modelSettings.defaultModel;
    const fallback = fallbackModel && fallbackModel !== 'auto'
      ? [{
          value: fallbackModel,
          label: resolveModelDisplayName(fallbackModel, modelDisplayNames),
          provider: displayProviderName(resolvedRoute.provider),
          source: t('settings.statusLocalSource'),
          routeKind: 'config' as const,
          routeLabel: t('settings.statusLocalSource'),
          resolvedModel: resolvedRoute.model,
          status: 'configured',
          default: true,
        }]
      : [];
    return uniqueModelOptions([...catalogOptions, ...fallback], modelDisplayNames, selectedAgent?.runtimeId ?? selectedAgent?.id).sort((a, b) => {
      if (a.default !== b.default) return a.default ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [
    modelCatalog,
    modelDisplayNames,
    modelSettings.defaultModel,
    resolvedRoute.model,
    resolvedRoute.provider,
    routeModel,
    selectedAgent,
    t,
  ]);
  const selectedModelOption = findSelectedModelOption(modelPickerOptions, selectedCatalogRoute, model, resolvedRoute.model, modelDisplayNames);
  const displayedModelValue = selectedModelOption?.value ?? model ?? resolvedRoute.model ?? '';
  const displayedModelLabel = selectedModelOption?.label
    ?? (resolveModelDisplayName(resolvedRoute.model ?? model, modelDisplayNames) || t('prompt.model'));
  const providerLabel = selectedModelOption?.provider
    ?? (displayProviderName(resolvedRoute.provider) ?? t('prompt.routeAuto'));
  const activeRunSettings = [
    ...(model.trim() || selectedCatalogRoute ? [{
      id: 'model',
      label: t('prompt.activeSetting.model'),
      value: displayedModelLabel,
      title: [
        selectedModelOption?.provider,
        selectedModelOption?.requestModel,
        selectedModelOption?.modelAlias ? t('prompt.routeAlias') + `: ${selectedModelOption.modelAlias}` : '',
      ].filter(Boolean).join(' · ') || displayedModelLabel,
      clearLabel: t('prompt.clearModelRoute'),
      onClear: () => {
        setModel('');
        setSelectedCatalogRoute(null);
      },
    }] : []),
    ...(reasoningEffort ? [{
      id: 'reasoning',
      label: t('prompt.activeSetting.reasoning'),
      value: t(`prompt.reasoning.${reasoningEffort}`),
      title: t('prompt.clearReasoning'),
      clearLabel: t('prompt.clearReasoning'),
      onClear: () => setReasoningEffort(''),
    }] : []),
    ...(permissionMode !== 'default' ? [{
      id: 'permission',
      label: t('prompt.activeSetting.permission'),
      value: permissionLabel,
      title: t('prompt.clearPermissionMode'),
      clearLabel: t('prompt.clearPermissionMode'),
      onClear: () => setPermissionMode('default'),
    }] : []),
    ...(workDir.trim() ? [{
      id: 'workspace',
      label: t('prompt.activeSetting.workspace'),
      value: compactPathLabel(workDir),
      title: workDir,
      clearLabel: t('prompt.clearWorkDir'),
      onClear: () => applyWorkDir(''),
    }] : []),
  ];
  const handleModelChange = useCallback((value: string, option?: ModelReasoningOption) => {
    setModel(value);
    if (!option?.requestModel && !option?.providerId && !option?.modelAlias) {
      setSelectedCatalogRoute(null);
      return;
    }
    setSelectedCatalogRoute({
      optionId: option.id,
      value,
      requestModel: option.requestModel ?? option.resolvedModel ?? value,
      provider: option.providerId,
      modelAlias: option.modelAlias,
    });
  }, []);
  const slashCommands = useMemo<SlashCommand[]>(() => {
    const commands: SlashCommand[] = [];
    const agentGroup = t('prompt.slash.groupAgents');
    agents
      .filter((agent) => agent.status !== 'unavailable')
      .slice(0, 8)
      .forEach((agent) => {
        commands.push({
          id: `agent-${commandIdFragment(agent.id)}`,
          group: agentGroup,
          label: `@${agent.name}`,
          description: agent.description || t('prompt.slash.agentDesc'),
          keywords: ['agent', 'runtime', agent.id, agent.name],
          run: () => {
            removeSlashTrigger();
            onSelectAgent(agent.id);
            closeSlash();
            inputRef.current?.focus();
          },
        });
      });

    modelPickerOptions.slice(0, MAX_SLASH_MODEL_OPTIONS).forEach((option) => {
      commands.push({
        id: `model-${commandIdFragment(option.id ?? option.value)}`,
        group: t('prompt.slash.groupModels'),
        label: option.label,
        description: [option.provider, option.source, option.description].filter(Boolean).join(' · ') || t('prompt.slash.modelDesc'),
        keywords: ['model', option.value, option.label, option.provider, option.source, option.resolvedModel].filter(Boolean) as string[],
        run: () => {
          removeSlashTrigger();
          handleModelChange(option.value, option);
          closeSlash();
          inputRef.current?.focus();
        },
      });
    });

    REASONING_EFFORTS.forEach((effort) => {
      commands.push({
        id: `reasoning-${effort}`,
        group: t('prompt.slash.groupReasoning'),
        label: t('prompt.slash.reasoning', { value: t(`prompt.reasoning.${effort}`) }),
        description: t('prompt.slash.reasoningDesc'),
        keywords: ['reasoning', effort, t(`prompt.reasoning.${effort}`)],
        run: () => {
          removeSlashTrigger();
          setReasoningEffort(effort);
          closeSlash();
          inputRef.current?.focus();
        },
      });
    });

    PERMISSION_MODES.forEach((mode) => {
      commands.push({
        id: `permission-${mode}`,
        group: t('prompt.slash.groupPermissions'),
        label: t('prompt.slash.permission', { value: t(`prompt.permission.${mode}`) }),
        description: t('prompt.slash.permissionDesc'),
        keywords: ['permission', mode, t(`prompt.permission.${mode}`)],
        run: () => {
          removeSlashTrigger();
          setPermissionMode(mode);
          closeSlash();
          inputRef.current?.focus();
        },
      });
    });

    commands.push(
      {
        id: 'workspace-open',
        group: t('prompt.slash.groupWorkspace'),
        label: t('prompt.slash.workspace'),
        description: workDir.trim()
          ? t('prompt.slash.workspaceDescSelected', { value: compactPathLabel(workDir) })
          : t('prompt.slash.workspaceDesc'),
        keywords: ['workspace', 'workdir', 'folder', 'target'],
        run: () => {
          removeSlashTrigger();
          setWorkTargetOpen(true);
          closeSlash();
          inputRef.current?.focus();
        },
      },
      {
        id: 'workspace-local-edge',
        group: t('prompt.slash.groupWorkspace'),
        label: t('prompt.slash.localEdge'),
        description: t('prompt.targetLocalEdgeDesc'),
        keywords: ['workspace', 'local', 'edge', 'default'],
        run: () => {
          removeSlashTrigger();
          setWorkDir('');
          setWorkDirDraft('');
          setWorkTargetOpen(false);
          closeSlash();
          inputRef.current?.focus();
        },
      },
    );

    if (onRetryLast) {
      commands.push({
        id: 'retry',
        group: t('prompt.slash.groupActions'),
        label: t('prompt.slash.retry'),
        description: t('prompt.slash.retryDesc'),
        keywords: ['retry', 'rerun', 'again'],
        run: () => {
          removeSlashTrigger();
          closeSlash();
          inputRef.current?.focus();
          void onRetryLast();
        },
      });
    }

    if (onForkThread) {
      commands.push({
        id: 'fork',
        group: t('prompt.slash.groupActions'),
        label: t('prompt.slash.fork'),
        description: t('prompt.slash.forkDesc'),
        keywords: ['fork', 'branch', 'thread'],
        run: () => {
          removeSlashTrigger();
          closeSlash();
          inputRef.current?.focus();
          void onForkThread();
        },
      });
    }

    commands.push({
      id: 'clear',
      group: t('prompt.slash.groupActions'),
      label: t('prompt.slash.clear'),
      description: t('prompt.slash.clearDesc'),
      keywords: ['clear', 'reset', 'composer'],
      run: clearComposer,
    });

    return commands;
  }, [
    agents,
    clearComposer,
    closeSlash,
    handleModelChange,
    modelPickerOptions,
    onSelectAgent,
    onForkThread,
    onRetryLast,
    removeSlashTrigger,
    t,
    workDir,
  ]);
  const filteredSlashCommands = useMemo(
    () => slashCommands.filter((command) => slashCommandMatches(command, slashQuery)).slice(0, 14),
    [slashCommands, slashQuery],
  );

  useEffect(() => {
    if (slashIndex < filteredSlashCommands.length) return;
    setSlashIndex(Math.max(0, filteredSlashCommands.length - 1));
  }, [filteredSlashCommands.length, slashIndex]);

  const runSlashCommand = useCallback((command: SlashCommand) => {
    command.run();
  }, []);

  const handleSlashKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!slashOpen) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSlash();
      return true;
    }
    if (filteredSlashCommands.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSlashIndex((current) => Math.min(current + 1, filteredSlashCommands.length - 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSlashIndex((current) => Math.max(current - 1, 0));
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const command = filteredSlashCommands[slashIndex] ?? filteredSlashCommands[0];
      if (command) runSlashCommand(command);
      return true;
    }
    return false;
  }, [closeSlash, filteredSlashCommands, runSlashCommand, slashIndex, slashOpen]);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (handleSlashKeyDown(e)) return;
    if (mentionHandleKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend, handleSlashKeyDown, mentionHandleKeyDown]);

  return (
    <div className={styles.root}>
      <MentionPopover
        items={mentionFiltered} isOpen={mentionOpen} query={mentionQuery}
        position={mentionPosition} selectedIndex={mentionIndex}
        onSelect={mentionSelectItem} onClose={closeMention}
      />

      <div className={styles.capsule}>
        <input
          ref={attachmentInputRef}
          className={styles.hiddenFileInput}
          data-testid="prompt-attachment-input"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => void handleBrowserAttachmentChange(event)}
        />

        {slashOpen && (
          <div className={styles.slashPalette} role="listbox" aria-label={t('prompt.slash.commands')}>
            <div className={styles.slashHeader}>
              <span>{t('prompt.slash.commands')}</span>
              <kbd>/</kbd>
            </div>
            {filteredSlashCommands.length === 0 ? (
              <div className={styles.slashEmpty}>{t('prompt.slash.empty')}</div>
            ) : filteredSlashCommands.map((command, index) => {
              const previous = filteredSlashCommands[index - 1];
              const showGroup = !previous || previous.group !== command.group;
              return (
                <div key={command.id} className={styles.slashCommandWrap}>
                  {showGroup && <div className={styles.slashGroup}>{command.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === slashIndex}
                    className={`${styles.slashCommand} ${index === slashIndex ? styles.slashCommandActive : ''}`}
                    data-testid={`slash-command-${command.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runSlashCommand(command)}
                  >
                    <span className={styles.slashCommandLabel}>{command.label}</span>
                    <span className={styles.slashCommandDesc}>{command.description}</span>
                  </button>
                </div>
              );
            })}
          </div>
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

        {attachments.length > 0 && (
          <div className={styles.attachmentTray} aria-label={t('prompt.attachSelected')}>
            {attachments.map((attachment) => (
              <span key={attachment.id} className={styles.attachmentChip}>
                <FileText size={13} />
                <span className={styles.attachmentName}>{attachment.name}</span>
                <span className={styles.attachmentMeta}>
                  {attachment.path ? t('prompt.attachmentSourceDesktop') : t('prompt.attachmentSourceBrowser')}
                  {formatBytes(attachment.size) ? ` · ${formatBytes(attachment.size)}` : ''}
                </span>
                <button
                  type="button"
                  aria-label={t('prompt.removeAttachment', { name: attachment.name })}
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {activeRunSettings.length > 0 && (
          <div
            className={styles.runSettingsStrip}
            aria-label={t('prompt.activeRunSettings')}
            data-testid="prompt-active-run-settings"
          >
            {activeRunSettings.map((setting) => (
              <span key={setting.id} className={styles.runSettingChip} title={setting.title}>
                <span className={styles.runSettingLabel}>{setting.label}</span>
                <strong>{setting.value}</strong>
                <button
                  type="button"
                  aria-label={setting.clearLabel}
                  onClick={setting.onClear}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* bottom action bar */}
        <div className={styles.actions}>
          <div className={styles.leftGroup}>
            <button
              type="button"
              className={`${styles.attachBtn} ${attachments.length > 0 ? styles.attachBtnActive : ''}`}
              disabled={disabled || isStarting}
              title={t('prompt.attachCustom')}
              aria-label={t('prompt.attachCustom')}
              onClick={() => void handleAttach()}
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
            <div className={styles.workTarget} ref={workTargetRef}>
              <button
                type="button"
                className={`${styles.workTargetBtn} ${workDir.trim() || workTargetOpen ? styles.workTargetBtnActive : ''}`}
                data-testid="prompt-work-target-button"
                disabled={disabled || isStarting}
                aria-label={t('prompt.workTarget')}
                aria-expanded={workTargetOpen}
                aria-haspopup="dialog"
                title={workDir.trim() ? `${t('prompt.workDir')}: ${workDir}` : t('prompt.targetLocalEdgeDesc')}
                onClick={() => setWorkTargetOpen((open) => !open)}
              >
                <FolderOpen size={15} strokeWidth={2.2} />
                <span>{workTargetLabel}</span>
                <ChevronDown size={13} strokeWidth={2.2} />
              </button>

              {workTargetOpen && (
                <div className={styles.workTargetMenu} role="dialog" aria-label={t('prompt.workTarget')}>
                  <div className={styles.workTargetHeader}>
                    <span>{t('prompt.workTarget')}</span>
                    <small>{t('prompt.workTargetDesc')}</small>
                  </div>

                  <button
                    type="button"
                    className={`${styles.workTargetOption} ${!workDir.trim() ? styles.workTargetOptionActive : ''}`}
                    onClick={() => {
                      applyWorkDir('', { closeMenu: true });
                    }}
                  >
                    <HardDrive size={16} />
                    <span>
                      <strong>{t('prompt.targetLocalEdge')}</strong>
                      <small>{t('prompt.targetLocalEdgeDesc')}</small>
                    </span>
                    {!workDir.trim() && <Check size={15} />}
                  </button>

                  <div className={styles.workDirEditor}>
                    <label htmlFor="prompt-work-dir">{t('prompt.targetFolder')}</label>
                    <div className={styles.workDirInputRow}>
                      <input
                        id="prompt-work-dir"
                        value={workDirDraft}
                        placeholder={t('prompt.workDirPlaceholder')}
                        onChange={(event) => setWorkDirDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        className={styles.workDirBrowseBtn}
                        disabled={!desktopRuntimeAvailable || disabled || isStarting}
                        aria-label={t('prompt.browseWorkDir')}
                        title={desktopRuntimeAvailable ? t('prompt.browseWorkDir') : t('prompt.browseWorkDirUnavailable')}
                        onClick={() => void handleBrowseWorkDir()}
                      >
                        {t('prompt.browseWorkDir')}
                      </button>
                      <button
                        type="button"
                        className={styles.workDirApplyBtn}
                        onClick={() => {
                          applyWorkDir(workDirDraft, { closeMenu: true });
                        }}
                      >
                        {t('prompt.applyWorkDir')}
                      </button>
                    </div>
                    <small>{t('prompt.targetFolderDesc')}</small>
                  </div>

                  {recentWorkDirOptions.length > 0 && (
                    <div className={styles.workTargetGroup}>
                      <div className={styles.workTargetGroupHeader}>
                        <span>{t('prompt.targetRecentWorkspaces')}</span>
                        <button type="button" onClick={clearRecentWorkDirs}>
                          {t('prompt.clearRecentWorkspaces')}
                        </button>
                      </div>
                      {recentWorkDirOptions.map((path) => {
                        const active = sameWorkDir(path, workDir);
                        return (
                          <button
                            key={path}
                            type="button"
                            className={`${styles.workTargetOption} ${active ? styles.workTargetOptionActive : ''}`}
                            onClick={() => applyWorkDir(path, { closeMenu: true })}
                          >
                            <Clock3 size={16} />
                            <span>
                              <strong>{compactPathLabel(path)}</strong>
                              <small>{path}</small>
                              <em className={styles.workTargetMeta}>
                                {t('prompt.targetRecentRunWorkDir')}
                              </em>
                            </span>
                            {active && <Check size={15} />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {directTargets.length > 0 && (
                    <div className={styles.workTargetGroup}>
                      <span>{t('prompt.targetRegisteredLocal')}</span>
                      {directTargets.map((target) => {
                        const root = targetWorkspaceRoot(target);
                        const active = Boolean(root && root === workDir);
                        return (
                          <button
                            key={target.id}
                            type="button"
                            className={`${styles.workTargetOption} ${active ? styles.workTargetOptionActive : ''}`}
                            onClick={() => applyWorkDir(root, { closeMenu: true })}
                          >
                            <Server size={16} />
                            <span>
                              <strong>{target.name}</strong>
                              <small>{root}</small>
                              <em className={styles.workTargetMeta}>
                                {t(`prompt.targetHealth.${target.health_state}`)} · {targetTrustLabel(target, t)}
                              </em>
                            </span>
                            {active && <Check size={15} />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {unavailableLocalTargets.length > 0 && (
                    <div className={styles.workTargetGroup}>
                      <span>{t('prompt.targetRegisteredLocalUnavailable')}</span>
                      {unavailableLocalTargets.map((target) => (
                        <button key={target.id} type="button" className={styles.workTargetOption} disabled>
                          <Server size={16} />
                          <span>
                            <strong>{target.name}</strong>
                            <small>{directTargetUnavailableReason(target, t)}</small>
                            <em className={styles.workTargetMeta}>
                              {t(`prompt.targetHealth.${target.health_state}`)} · {targetTrustLabel(target, t)}
                            </em>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {remoteInventoryTargets.length > 0 && (
                    <div className={styles.workTargetGroup}>
                      <span>{t('prompt.targetRemoteInventory')}</span>
                      {remoteInventoryTargets.map((target) => (
                        <button key={target.id} type="button" className={styles.workTargetOption} disabled>
                          <Server size={16} />
                          <span>
                            <strong>{target.name}</strong>
                            <small>{directTargetUnavailableReason(target, t)}</small>
                            <em className={styles.workTargetMeta}>
                              {t(`settings.targetType.${target.target_type}`, { defaultValue: target.target_type })} · {t(`prompt.targetHealth.${target.health_state}`)} · {targetTrustLabel(target, t)}
                            </em>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={styles.rightGroup}>
            <div className={styles.routePreview} aria-label={t('prompt.routePreview')} title={providerLabel} />
            <div className={styles.metaChain}>
              <ModelReasoningPicker
                models={modelPickerOptions}
                modelValue={displayedModelValue}
                modelLabel={displayedModelLabel}
                reasoningValue={effectiveReasoning}
                reasoningLabel={t(`prompt.reasoning.${effectiveReasoning}`)}
                reasoningOptions={REASONING_EFFORTS.map((r) => ({ value: r, label: t(`prompt.reasoning.${r}`) }))}
                disabled={disabled || isStarting}
                ariaLabel={t('prompt.modelReasoning')}
                onModelChange={handleModelChange}
                onReasoningChange={(v) => setReasoningEffort(v as ReasoningEffort)}
                modelDisplayNames={modelDisplayNames}
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
