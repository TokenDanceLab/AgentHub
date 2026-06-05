import { useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot, X, Send, Save, Globe2, Sparkles, Code2, Wrench,
  FileText, Terminal, Search, Globe, FolderOpen, GitBranch,
  Variable, BookOpen, ChevronLeft, ChevronRight, Check,
} from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import type { AgentTemplate } from '../agentCreation/agentCreationTypes';
import { saveCustomAgent, loadCustomAgents, type StoredCustomAgent } from '../agentCreation/agentStore';
import { emojiOptions, modelOptions, reasoningOptions, capabilityLabels } from '../agentCreation/agentTemplates';
import type { CustomAgentMarketItem } from '../sections/AgentMarketSection';
import PublishAgentModal from './PublishAgentModal';
import styles from '../primitives/primitives.module.css';

export interface CustomAgentDraft {
  name: string;
  emoji: string;
  description: string;
  agentType: string;
  systemPrompt: string;
  capabilities: string[];
  tools: string[];
  model: string;
  provider: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: string;
  knowledgeBase: string;
}

const STORAGE_KEY = 'agenthub-settings.customAgentDrafts';

const VARIABLES = [
  { key: '$user', labelKey: 'settings.agentCreator.variableUser' },
  { key: '$project', labelKey: 'settings.agentCreator.variableProject' },
  { key: '$date', labelKey: 'settings.agentCreator.variableDate' },
  { key: '$files', labelKey: 'settings.agentCreator.variableFiles' },
  { key: '$language', labelKey: 'settings.agentCreator.variableLanguage' },
  { key: '$os', labelKey: 'settings.agentCreator.variableOs' },
] as const;

const AGENT_TYPES = [
  { value: 'assistant', label: 'settings.agentCreator.typeAssistant' },
  { value: 'coder', label: 'settings.agentCreator.typeCoder' },
  { value: 'reviewer', label: 'settings.agentCreator.typeReviewer' },
  { value: 'researcher', label: 'settings.agentCreator.typeResearcher' },
  { value: 'custom', label: 'settings.agentCreator.typeCustom' },
] as const;

const TOOL_CATALOG = [
  { id: 'read_file', label: 'settings.agentCreator.toolReadFile', icon: FileText, cat: 'read' },
  { id: 'write_file', label: 'settings.agentCreator.toolWriteFile', icon: FileText, cat: 'write' },
  { id: 'edit_file', label: 'settings.agentCreator.toolEditFile', icon: Code2, cat: 'write' },
  { id: 'execute_command', label: 'settings.agentCreator.toolExecCommand', icon: Terminal, cat: 'bash' },
  { id: 'search_code', label: 'settings.agentCreator.toolSearchCode', icon: Search, cat: 'grep' },
  { id: 'grep', label: 'settings.agentCreator.toolGrep', icon: Search, cat: 'grep' },
  { id: 'glob', label: 'settings.agentCreator.toolGlob', icon: FolderOpen, cat: 'grep' },
  { id: 'web_search', label: 'settings.agentCreator.toolWebSearch', icon: Globe, cat: 'web' },
  { id: 'web_fetch', label: 'settings.agentCreator.toolWebFetch', icon: Globe, cat: 'web' },
  { id: 'browser', label: 'settings.agentCreator.toolBrowser', icon: Globe, cat: 'web' },
  { id: 'git', label: 'settings.agentCreator.toolGit', icon: GitBranch, cat: 'vcs' },
  { id: 'mcp', label: 'settings.agentCreator.toolMcp', icon: Wrench, cat: 'integration' },
  { id: 'run_agent', label: 'settings.agentCreator.toolRunAgent', icon: Bot, cat: 'integration' },
] as const;

const MODEL_CHOICES = [
  { model: 'deepseek-v4-pro', provider: 'tokendance-gateway', label: 'DeepSeek V4 Pro (Opus)' },
  { model: 'deepseek-v4-flash', provider: 'tokendance-gateway', label: 'DeepSeek V4 Flash (Sonnet)' },
  { model: 'glm-5.1', provider: 'tokendance-gateway', label: 'GLM 5.1 (Haiku)' },
  { model: 'custom', provider: '', labelKey: 'settings.agentCreator.customModel' },
] as const;

interface WizardStep {
  id: number;
  titleKey: string;
  descriptionKey: string;
}

const WIZARD_STEPS: WizardStep[] = [
  { id: 1, titleKey: 'settings.wizard.step1', descriptionKey: 'settings.wizard.step1Desc' },
  { id: 2, titleKey: 'settings.wizard.step2', descriptionKey: 'settings.wizard.step2Desc' },
  { id: 3, titleKey: 'settings.wizard.step3', descriptionKey: 'settings.wizard.step3Desc' },
  { id: 4, titleKey: 'settings.wizard.step4', descriptionKey: 'settings.wizard.step4Desc' },
  { id: 5, titleKey: 'settings.wizard.step5', descriptionKey: 'settings.wizard.step5Desc' },
];

const TOTAL_STEPS = WIZARD_STEPS.length;

interface TestMessage { role: 'user' | 'assistant'; content: string; }

function applyVariables(prompt: string): string {
  const now = new Date();
  return prompt
    .replace(/\$user/g, 'Test User')
    .replace(/\$project/g, '/workspace/my-project')
    .replace(/\$date/g, now.toISOString())
    .replace(/\$files/g, 'src/index.ts, src/utils.ts')
    .replace(/\$language/g, 'TypeScript')
    .replace(/\$os/g, navigator.platform ?? 'unknown');
}

function makeDefaultDraft(): CustomAgentDraft {
  return {
    name: '',
    emoji: '\u{1f916}',
    description: '',
    agentType: 'assistant',
    systemPrompt: 'You are a helpful assistant.\n\nProject: $project\nLanguage: $language\nDate: $date',
    capabilities: [],
    tools: ['read_file', 'write_file', 'execute_command', 'search_code', 'grep', 'glob'],
    model: 'deepseek-v4-flash',
    provider: 'tokendance-gateway',
    temperature: 0.5,
    maxTokens: 8192,
    reasoningEffort: 'high',
    knowledgeBase: '',
  };
}

function draftFromStoredAgent(stored: StoredCustomAgent): CustomAgentDraft {
  const toolKeys = Object.entries(stored.capabilities)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return {
    name: stored.name,
    emoji: stored.emoji,
    description: stored.description,
    agentType: 'assistant',
    systemPrompt: stored.systemPrompt,
    capabilities: [],
    tools: toolKeys.length > 0 ? toolKeys : ['read_file', 'write_file', 'execute_command', 'search_code', 'grep', 'glob'],
    model: stored.model,
    provider: 'tokendance-gateway',
    temperature: stored.temperature,
    maxTokens: stored.maxTokens,
    reasoningEffort: stored.reasoningEffort,
    knowledgeBase: stored.knowledgeBase,
  };
}

function draftFromTemplate(template: AgentTemplate): CustomAgentDraft {
  const toolKeys: string[] = [];
  const cap = template.capabilities;
  if (cap.read) toolKeys.push('read_file');
  if (cap.write) toolKeys.push('write_file', 'edit_file');
  if (cap.bash) toolKeys.push('execute_command');
  if (cap.grep) toolKeys.push('grep', 'glob', 'search_code');
  if (cap.webSearch) toolKeys.push('web_search', 'web_fetch');
  if (cap.mcpIntegration) toolKeys.push('mcp');
  if (cap.subAgentSpawn) toolKeys.push('run_agent');
  if (cap.fileChanges) toolKeys.push('git');

  return {
    name: template.name,
    emoji: template.emoji,
    description: template.description,
    agentType: 'assistant',
    systemPrompt: template.systemPrompt,
    capabilities: [],
    tools: toolKeys,
    model: template.modelPreference.model,
    provider: 'tokendance-gateway',
    temperature: template.modelPreference.temperature,
    maxTokens: template.modelPreference.maxTokens,
    reasoningEffort: template.modelPreference.reasoningEffort,
    knowledgeBase: '',
  };
}

export function readCustomAgentDrafts(): CustomAgentMarketItem[] {
  const results: CustomAgentMarketItem[] = [];

  // Read legacy drafts from old STORAGE_KEY
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).id === 'string') {
            results.push(item as CustomAgentMarketItem);
          }
        }
      }
    }
  } catch { /* noop */ }

  // Also read from the newer agentStore format
  try {
    const stored = loadCustomAgents();
    for (const a of stored) {
      if (!results.some((r) => r.id === a.id)) {
        results.push({
          id: a.id,
          name: a.name,
          agentType: a.source,
          systemPrompt: a.systemPrompt,
          capabilities: Object.entries(a.capabilities).filter(([, v]) => v).map(([k]) => k),
          source: a.source,
          updatedAt: a.updatedAt,
        });
      }
    }
  } catch { /* noop */ }

  return results;
}

export default function CustomAgentCreator({
  agents: _agents,
  onClose,
  onSaved,
  initialTemplate,
  editAgentId,
}: {
  agents: AgentInfo[];
  onClose: () => void;
  onSaved: () => void;
  initialTemplate?: AgentTemplate | null;
  editAgentId?: string | null;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CustomAgentDraft>(() => {
    if (editAgentId) {
      const stored = loadCustomAgents().find((a) => a.id === editAgentId);
      if (stored) return draftFromStoredAgent(stored);
    }
    return initialTemplate ? draftFromTemplate(initialTemplate) : makeDefaultDraft();
  });
  const [currentStep, setCurrentStep] = useState(1);
  const [testInput, setTestInput] = useState('');
  const [testMessages, setTestMessages] = useState<TestMessage[]>([]);
  const [testRunning, setTestRunning] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const markStepCompleted = useCallback((step: number) => {
    setCompletedSteps((prev) => { const s = new Set(prev); s.add(step); return s; });
  }, []);

  const updateField = useCallback(<K extends keyof CustomAgentDraft>(key: K, value: CustomAgentDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleTool = useCallback((toolId: string) => {
    setDraft((prev) => {
      const tools = prev.tools.includes(toolId)
        ? prev.tools.filter((t) => t !== toolId)
        : [...prev.tools, toolId];
      return { ...prev, tools };
    });
  }, []);

  const insertVariable = useCallback((variable: string) => {
    setDraft((prev) => ({ ...prev, systemPrompt: prev.systemPrompt + variable }));
  }, []);

  const handleNext = useCallback(() => {
    markStepCompleted(currentStep);
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep, markStepCompleted]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const handleSave = useCallback(() => {
    if (!draft.name.trim()) return;

    const now = new Date().toISOString();
    const existingAgent = editAgentId ? loadCustomAgents().find((a) => a.id === editAgentId) : undefined;
    const id = existingAgent
      ? existingAgent.id
      : (draft.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || `custom-${Date.now()}`);

    const stored: StoredCustomAgent = {
      id,
      name: draft.name.trim(),
      emoji: draft.emoji,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      model: draft.model,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      reasoningEffort: draft.reasoningEffort,
      capabilities: Object.fromEntries(draft.tools.map((t) => [t, true])),
      knowledgeBase: draft.knowledgeBase,
      source: 'local',
      createdAt: existingAgent?.createdAt ?? now,
      updatedAt: now,
    };
    saveCustomAgent(stored);

    // Also persist to legacy store for AgentMarketCard compatibility
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
      const arr = Array.isArray(existing) ? existing as CustomAgentMarketItem[] : [];
      const idx = arr.findIndex((a) => a.id === id);
      const item: CustomAgentMarketItem = {
        id,
        name: draft.name.trim(),
        agentType: draft.agentType,
        systemPrompt: draft.systemPrompt,
        capabilities: draft.tools,
        source: 'local',
        updatedAt: now,
      };
      if (idx >= 0) {
        arr[idx] = item;
      } else {
        arr.push(item);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch { /* storage full */ }

    onSaved();
    onClose();
  }, [draft, onClose, onSaved, editAgentId]);

  const handlePublish = useCallback(() => {
    if (!draft.name.trim()) return;
    // Save the draft first to ensure latest state
    const now = new Date().toISOString();
    const id = draft.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || `custom-${Date.now()}`;
    const stored: StoredCustomAgent = {
      id,
      name: draft.name.trim(),
      emoji: draft.emoji,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      model: draft.model,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      reasoningEffort: draft.reasoningEffort,
      capabilities: Object.fromEntries(draft.tools.map((t) => [t, true])),
      knowledgeBase: draft.knowledgeBase,
      source: 'local',
      createdAt: now,
      updatedAt: now,
    };
    saveCustomAgent(stored);
    // Show publish modal
    setShowPublishModal(true);
  }, [draft]);

  const handlePublished = useCallback(() => {
    setShowPublishModal(false);
    onSaved();
    onClose();
  }, [onClose, onSaved]);

  const handleTestSend = useCallback(() => {
    const input = testInput.trim();
    if (!input) return;
    setTestMessages((prev) => [...prev, { role: 'user', content: input }]);
    setTestInput('');
    setTestRunning(true);
    const resolvedPrompt = applyVariables(draft.systemPrompt);
    setTimeout(() => {
      const preview = `[Sandbox preview with model ${draft.model}]\n\nPrompt template resolved:\n---\n${resolvedPrompt.slice(0, 512)}${resolvedPrompt.length > 512 ? '...' : ''}\n---\n\nTo: "${input}"\n\nThis is a simulated sandbox response. The agent would process your request using the configured model, tools (${draft.tools.join(', ') || 'none'}), reasoning level "${draft.reasoningEffort}", temperature ${draft.temperature}, max tokens ${draft.maxTokens}.`;
      setTestMessages((prev) => [...prev, { role: 'assistant', content: preview }]);
      setTestRunning(false);
    }, 800);
  }, [testInput, draft]);

  const testInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTestSend(); }
  }, [handleTestSend]);

  const isValid = draft.name.trim().length > 0 && draft.systemPrompt.trim().length > 0;
  const isLastStep = currentStep === TOTAL_STEPS;
  const isFirstStep = currentStep === 1;

  return (
    <div className={styles.creatorOverlay} onClick={onClose}>
      <div className={styles.creatorDialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.creatorHeader}>
          <div className={styles.creatorHeaderLeft}>
            <div className={styles.profileIcon}>
              {initialTemplate ? <BookOpen size={17} /> : <Sparkles size={17} />}
            </div>
            <div>
              <h2>{initialTemplate ? t('settings.agentCreator.titleFromTemplate', { name: draft.name }) : t('settings.agentCreator.title')}</h2>
              <span>{t('settings.agentCreator.desc')}</span>
            </div>
          </div>
          <button type="button" className={styles.creatorCloseBtn} onClick={onClose} aria-label={t('settings.agentCreator.close')}>
            <X size={18} />
          </button>
        </div>

        {/* ---- Wizard Progress Bar ---- */}
        <div className={styles.wizardProgressBar}>
          {WIZARD_STEPS.map((step, idx) => {
            const active = currentStep === step.id;
            const completed = completedSteps.has(step.id) && !active;
            const stepClass = active
              ? styles.wizardStepActive
              : completed
                ? styles.wizardStepCompleted
                : '';
            return (
              <div key={step.id} className={styles.wizardStep + (stepClass ? ` ${stepClass}` : '')} onClick={() => {
                if (completed || step.id <= Math.max(...completedSteps, currentStep)) {
                  setCurrentStep(step.id);
                }
              }}>
                <div className={styles.wizardStepIndicator}>
                  {completed ? <Check size={12} /> : step.id}
                </div>
                <span className={styles.wizardStepLabel}>{t(step.titleKey)}</span>
                {idx < WIZARD_STEPS.length - 1 && (
                  <div className={`${styles.wizardStepConnector} ${completed ? styles.wizardStepConnectorCompleted : ''}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Progress subtitle */}
        <div style={{ padding: '8px 24px 0', fontSize: 11, color: 'var(--settings-muted)' }}>
          {t('settings.wizard.progress', { current: currentStep, total: TOTAL_STEPS })} &mdash; {t(WIZARD_STEPS[currentStep - 1]?.descriptionKey ?? '')}
        </div>

        {/* ---- Step Content ---- */}
        <div className={styles.creatorBody}>
          {/* Step 1: Basic Info */}
          {currentStep === 1 && (
            <div className={styles.creatorSection}>
              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.emoji')}</label>
                <div className={styles.creatorEmojiGrid}>
                  {emojiOptions.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className={`${styles.creatorEmojiOption} ${draft.emoji === em ? styles.creatorEmojiOptionSelected : ''}`}
                      onClick={() => updateField('emoji', em)}
                      title={em}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.agentName')}</label>
                <input
                  type="text"
                  className={styles.creatorInput}
                  value={draft.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder={t('settings.agentCreator.agentNamePlaceholder')}
                />
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.description')}</label>
                <input
                  type="text"
                  className={styles.creatorInput}
                  value={draft.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder={t('settings.agentCreator.descriptionPlaceholder')}
                />
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.agentType')}</label>
                <select
                  className={styles.creatorSelect}
                  value={draft.agentType}
                  onChange={(e) => updateField('agentType', e.target.value)}
                >
                  {AGENT_TYPES.map((at) => (
                    <option key={at.value} value={at.value}>{t(at.label)}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Step 2: System Prompt */}
          {currentStep === 2 && (
            <div className={styles.creatorSection}>
              <div className={styles.creatorField}>
                <div className={styles.creatorFieldLabelRow}>
                  <label>{t('settings.agentCreator.promptTemplate')}</label>
                  <div className={styles.creatorVariableBar}>
                    {VARIABLES.map((v) => (
                      <button key={v.key} type="button" className={styles.creatorVariableChip} onClick={() => insertVariable(v.key)} title={t(v.labelKey)}>
                        <Variable size={11} />{v.key}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  className={styles.creatorTextarea}
                  value={draft.systemPrompt}
                  onChange={(e) => updateField('systemPrompt', e.target.value)}
                  placeholder={t('settings.agentCreator.promptPlaceholder')}
                  rows={14}
                />
                <span className={styles.creatorFieldHint}>
                  {t('settings.agentCreator.variableHint')}
                </span>
              </div>
            </div>
          )}

          {/* Step 3: Model Settings */}
          {currentStep === 3 && (
            <div className={styles.creatorSection}>
              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.modelAssignment')}</label>
                <select
                  className={styles.creatorSelect}
                  value={`${draft.provider}:${draft.model}`}
                  onChange={(e) => {
                    const [provider, model] = e.target.value.split(':');
                    updateField('provider', provider ?? 'tokendance-gateway');
                    updateField('model', model ?? 'deepseek-v4-flash');
                  }}
                >
                  {MODEL_CHOICES.map((m) => (
                    <option key={m.model} value={`${m.provider}:${m.model}`}>{'labelKey' in m ? t(m.labelKey) : m.label}</option>
                  ))}
                </select>
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.temperature')} <span className={styles.creatorFieldHint}>{draft.temperature.toFixed(2)}</span></label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  className={styles.creatorRange}
                  value={draft.temperature}
                  onChange={(e) => updateField('temperature', parseFloat(e.target.value))}
                />
                <span className={styles.creatorFieldHint}>{t('settings.agentCreator.temperatureHint')}</span>
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.maxTokens')}</label>
                <input
                  type="number"
                  className={styles.creatorInput}
                  value={draft.maxTokens}
                  onChange={(e) => updateField('maxTokens', Math.max(1, parseInt(e.target.value, 10) || 4096))}
                  min={256}
                  max={200000}
                  step={1024}
                />
                <span className={styles.creatorFieldHint}>{t('settings.agentCreator.maxTokensHint')}</span>
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.reasoningLevel')}</label>
                <div className={styles.creatorReasoningGrid}>
                  {reasoningOptions.map((rl) => (
                    <label key={rl.value} className={`${styles.creatorReasoningCard} ${draft.reasoningEffort === rl.value ? styles.creatorReasoningCardActive : ''}`}>
                      <input
                        type="radio"
                        name="reasoning"
                        value={rl.value}
                        checked={draft.reasoningEffort === rl.value}
                        onChange={(e) => updateField('reasoningEffort', e.target.value)}
                      />
                      <span>{t(rl.labelKey)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <p className={styles.creatorSectionDesc}>{t('settings.agentCreator.modelHint')}</p>
            </div>
          )}

          {/* Step 4: Tool Selection */}
          {currentStep === 4 && (
            <div className={styles.creatorSection}>
              <p className={styles.creatorSectionDesc}>{t('settings.agentCreator.toolSelectionDesc')}</p>
              <div className={styles.creatorToolGrid}>
                {TOOL_CATALOG.map((tool) => {
                  const Icon = tool.icon;
                  const checked = draft.tools.includes(tool.id);
                  return (
                    <label key={tool.id} className={`${styles.creatorToolCard} ${checked ? styles.creatorToolCardChecked : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTool(tool.id)}
                        className={styles.creatorToolCheckbox}
                      />
                      <Icon size={16} />
                      <span>{t(tool.label)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 5: Knowledge Base + Test Chat */}
          {currentStep === 5 && (
            <div className={styles.creatorSection}>
              <p className={styles.creatorSectionDesc}>{t('settings.agentCreator.knowledgeDesc')}</p>
              <div className={styles.creatorField}>
                <label>{t('settings.agentCreator.knowledgeBase')}</label>
                <textarea
                  className={styles.creatorTextarea}
                  value={draft.knowledgeBase}
                  onChange={(e) => updateField('knowledgeBase', e.target.value)}
                  placeholder={t('settings.agentCreator.knowledgePlaceholder')}
                  rows={6}
                />
                <span className={styles.creatorFieldHint}>{t('settings.agentCreator.knowledgeHint')}</span>
              </div>

              <div className={styles.creatorField} style={{ marginTop: 16 }}>
                <label>{t('settings.agentCreator.testChatDesc')}</label>
              </div>
              <div className={styles.creatorTestChat}>
                {testMessages.length === 0 ? (
                  <div className={styles.creatorTestEmpty}>
                    <Bot size={32} />
                    <span>{t('settings.agentCreator.testChatEmpty')}</span>
                  </div>
                ) : (
                  <div className={styles.creatorTestMessages}>
                    {testMessages.map((msg, i) => (
                      <div key={i} className={`${styles.creatorTestMsg} ${msg.role === 'user' ? styles.creatorTestMsgUser : styles.creatorTestMsgAssistant}`}>
                        <span className={styles.creatorTestMsgRole}>
                          {msg.role === 'user' ? t('settings.agentCreator.testRoleYou') : draft.name || t('settings.agentCreator.testRoleAgent')}
                        </span>
                        <p>{msg.content}</p>
                      </div>
                    ))}
                    {testRunning && (
                      <div className={`${styles.creatorTestMsg} ${styles.creatorTestMsgAssistant}`}>
                        <span className={styles.creatorTestMsgRole}>{draft.name || t('settings.agentCreator.testRoleAgent')}</span>
                        <p className={styles.creatorTestTyping}>{t('settings.agentCreator.testTyping')}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className={styles.creatorTestInput}>
                <input
                  type="text"
                  className={styles.creatorInput}
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  onKeyDown={testInputKeyDown}
                  placeholder={t('settings.agentCreator.testInputPlaceholder')}
                  disabled={testRunning}
                />
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleTestSend}
                  disabled={testRunning || !testInput.trim()}
                >
                  <Send size={14} />
                  {t('settings.agentCreator.testSend')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- Footer with navigation ---- */}
        <div className={styles.creatorFooter}>
          <div>
            {!isFirstStep && (
              <button type="button" className={styles.secondaryBtn} onClick={handleBack}>
                <ChevronLeft size={14} />
                {t('settings.wizard.back')}
              </button>
            )}
          </div>
          <div className={styles.creatorFooterRight}>
            {isLastStep ? (
              <>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handlePublish}
                  disabled={!isValid}
                >
                  <Globe2 size={14} />
                  {t('settings.agentCreator.publishToHub')}
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleSave}
                  disabled={!isValid}
                >
                  <Save size={14} />
                  {t('settings.wizard.finish')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleNext}
              >
                {t('settings.wizard.next')}
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Publish modal */}
      {showPublishModal && (
        <PublishAgentModal
          agent={{
            id: draft.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || `custom-${Date.now()}`,
            name: draft.name.trim(),
            description: draft.description,
            agentType: draft.agentType,
            systemPrompt: draft.systemPrompt,
            capabilities: draft.tools,
            tools: draft.tools,
            model: draft.model,
            provider: draft.provider,
            version: '1.0.0',
          }}
          onClose={() => setShowPublishModal(false)}
          onPublished={handlePublished}
        />
      )}
    </div>
  );
}
