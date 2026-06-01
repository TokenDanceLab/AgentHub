import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown, ChevronUp, Globe, Wrench  } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import type { ResolvedRunModelSettings } from '@/stores/modelSettingsStore';
import {
  STORAGE_PREFIX,
  MODEL_OPTIONS,
  PROVIDER_OPTIONS,
  REASONING_OPTIONS,
} from '../settingsShared';
import styles from '../../SettingsPage.module.css';

// ── Types ───────────────────────────────────────────

export interface McpServerAttachment {
  url: string;
  enabled: boolean;
}

export interface AgentProfileData {
  systemPrompt: string;
  tools: ToolToggle[];
  modelOverride: string; // '' means "use default"
  providerOverride: string; // '' means "use default"
  reasoningOverride: string; // '' means "use default"
  temperature: number; // 0-2, step 0.01
  topP: number; // 0-1, step 0.01
  maxOutputTokens: number; // 256-200000
  webSearchEnabled: boolean;
  mcpServers: McpServerAttachment[];
  skillLinks: string[];
}

export interface ToolToggle {
  name: string;
  description: string;
  enabled: boolean;
}

interface LocalAgentProfileCardProps {
  agent: AgentInfo;
  alias?: string;
  route: ResolvedRunModelSettings;
  edgeOnline: boolean;
}

// ── Tool catalog ────────────────────────────────────

const TOOL_CATALOG: Array<{ name: string; descriptionKey: string }> = [
  { name: 'Read', descriptionKey: 'settings.tool.readDesc' },
  { name: 'Write', descriptionKey: 'settings.tool.writeDesc' },
  { name: 'Bash', descriptionKey: 'settings.tool.bashDesc' },
  { name: 'Grep', descriptionKey: 'settings.tool.grepDesc' },
  { name: 'Glob', descriptionKey: 'settings.tool.globDesc' },
  { name: 'WebFetch', descriptionKey: 'settings.tool.webFetchDesc' },
  { name: 'WebSearch', descriptionKey: 'settings.tool.webSearchDesc' },
  { name: 'Task', descriptionKey: 'settings.tool.taskDesc' },
];

const DEFAULT_TOOLS: ToolToggle[] = TOOL_CATALOG.map((t) => ({
  name: t.name,
  description: t.descriptionKey,
  enabled: true,
}));

function defaultProfileData(): AgentProfileData {
  return {
    systemPrompt: '',
    tools: DEFAULT_TOOLS.map((t) => ({ ...t })),
    modelOverride: '',
    providerOverride: '',
    reasoningOverride: '',
    temperature: 0.7,
    topP: 1.0,
    maxOutputTokens: 16384,
    webSearchEnabled: false,
    mcpServers: [],
    skillLinks: [],
  };
}

// ── localStorage helpers ────────────────────────────

function agentProfileKey(agentId: string): string {
  return `${STORAGE_PREFIX}agent-profile.${agentId}`;
}

function loadProfile(agentId: string): AgentProfileData {
  try {
    const raw = localStorage.getItem(agentProfileKey(agentId));
    if (raw) {
      const parsed = JSON.parse(raw) as AgentProfileData;
      // merge with defaults so new fields get populated
      const defaults = defaultProfileData();
      return {
        systemPrompt: parsed.systemPrompt ?? defaults.systemPrompt,
        tools: Array.isArray(parsed.tools) && parsed.tools.length === TOOL_CATALOG.length
          ? parsed.tools
          : defaults.tools,
        modelOverride: parsed.modelOverride ?? defaults.modelOverride,
        providerOverride: parsed.providerOverride ?? defaults.providerOverride,
        reasoningOverride: parsed.reasoningOverride ?? defaults.reasoningOverride,
        temperature: typeof parsed.temperature === 'number' ? parsed.temperature : defaults.temperature,
        topP: typeof parsed.topP === 'number' ? parsed.topP : defaults.topP,
        maxOutputTokens: typeof parsed.maxOutputTokens === 'number' ? parsed.maxOutputTokens : defaults.maxOutputTokens,
        webSearchEnabled: typeof parsed.webSearchEnabled === 'boolean' ? parsed.webSearchEnabled : defaults.webSearchEnabled,
        mcpServers: Array.isArray(parsed.mcpServers)
          ? parsed.mcpServers.map((s: unknown) =>
              typeof s === 'string'
                ? { url: s, enabled: true }
                : (s && typeof s === 'object' && 'url' in (s as Record<string, unknown>))
                  ? { url: String((s as McpServerAttachment).url ?? ''), enabled: (s as McpServerAttachment).enabled !== false }
                  : { url: '', enabled: true },
            )
          : [],
        skillLinks: Array.isArray(parsed.skillLinks) ? parsed.skillLinks : [],
      };
    }
  } catch {
    /* corrupted data - fall back to defaults */
  }
  return defaultProfileData();
}

function saveProfile(agentId: string, data: AgentProfileData): void {
  try {
    localStorage.setItem(agentProfileKey(agentId), JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
}

// ── Estimated token count ───────────────────────────

function estimateTokens(text: string): number {
  if (!text) return 0;
  // rough estimation: ~4 chars per token for English, ~1 char per token for CJK
  let cjk = 0;
  let ascii = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk++;
    } else if (code < 0x80) {
      ascii++;
    } else {
      // other scripts: ~2 chars per token
      ascii += 2;
    }
  }
  return Math.max(1, Math.round(cjk + ascii / 4));
}

// ── Component ───────────────────────────────────────

export default function LocalAgentProfileCard({
  agent,
  alias,
  route,
  edgeOnline,
}: LocalAgentProfileCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [profile, setProfile] = useState<AgentProfileData>(() => loadProfile(agent.id));

  const tokenEstimate = useMemo(() => estimateTokens(profile.systemPrompt), [profile.systemPrompt]);

  const profileReady = edgeOnline && agent.status === 'available';
  const hasChanges = useMemo(() => {
    const saved = loadProfile(agent.id);
    return JSON.stringify(saved) !== JSON.stringify(profile);
  }, [profile, agent.id]);

  const handleSave = useCallback(() => {
    saveProfile(agent.id, profile);
  }, [profile, agent.id]);

  const handleReset = useCallback(() => {
    const defaults = defaultProfileData();
    setProfile(defaults);
    saveProfile(agent.id, defaults);
  }, [agent.id]);

  const toggleTool = useCallback((index: number) => {
    setProfile((prev) => {
      const tools = prev.tools.map((t, i) => (i === index ? { ...t, enabled: !t.enabled } : t));
      return { ...prev, tools };
    });
  }, []);

  const addMcpServer = useCallback(() => {
    setProfile((prev) => ({
      ...prev,
      mcpServers: [...prev.mcpServers, { url: '', enabled: true }],
    }));
  }, []);

  const updateMcpServerUrl = useCallback((index: number, url: string) => {
    setProfile((prev) => {
      const servers = prev.mcpServers.map((s, i) => (i === index ? { ...s, url } : s));
      return { ...prev, mcpServers: servers };
    });
  }, []);

  const toggleMcpServer = useCallback((index: number) => {
    setProfile((prev) => {
      const servers = prev.mcpServers.map((s, i) => (i === index ? { ...s, enabled: !s.enabled } : s));
      return { ...prev, mcpServers: servers };
    });
  }, []);

  const removeMcpServer = useCallback((index: number) => {
    setProfile((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.filter((_, i) => i !== index),
    }));
  }, []);

  const addSkillLink = useCallback(() => {
    setProfile((prev) => ({
      ...prev,
      skillLinks: [...prev.skillLinks, ''],
    }));
  }, []);

  const updateSkillLink = useCallback((index: number, value: string) => {
    setProfile((prev) => {
      const links = prev.skillLinks.map((l, i) => (i === index ? value : l));
      return { ...prev, skillLinks: links };
    });
  }, []);

  const removeSkillLink = useCallback((index: number) => {
    setProfile((prev) => ({
      ...prev,
      skillLinks: prev.skillLinks.filter((_, i) => i !== index),
    }));
  }, []);

  const enabledToolCount = profile.tools.filter((t) => t.enabled).length;

  return (
    <div className={styles.profileCard}>
      <button
        type="button"
        className={styles.profileExpandTrigger}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={t('settings.profileEditAria', { runtime: agent.name, defaultValue: `Edit ${agent.name} profile` })}
      >
        <div className={styles.profileHeader}>
          <div className={styles.profileIcon}>
            <Bot size={17} />
          </div>
          <div>
            <strong>{t('settings.localProfileName', { runtime: agent.name })}</strong>
            <span>{t('settings.localProfileDesc')}</span>
          </div>
          <em
            className={`${styles.profileStatus} ${
              profileReady ? styles.profileStatus_available : styles.profileStatus_configuring
            }`}
          >
            {profileReady ? t('settings.enabled') : t('settings.notConfigured')}
          </em>
        </div>
        <div className={styles.profileMeta}>
          <span>{t('settings.profileRuntime')}: {agent.id}</span>
          <span>{t('settings.profileModel')}: {route.model ?? t('prompt.routeAuto')}</span>
          <span>{t('settings.modelAliasProvider')}: {route.provider ?? t('prompt.routeAuto')}</span>
          <span>{t('settings.modelAliasReasoning')}: {route.reasoningEffort ?? t('prompt.routeAuto')}</span>
          {alias ? <span>{t('settings.profileAlias')}: {alias}</span> : null}
          <span>{t('settings.executionTargets')}: {t('settings.targetLocalEdge')}</span>
          <span>{t('settings.profileConfigSource')}: AGENTS.md / memory / skills</span>
        </div>
        <div className={styles.profileExpandArrow}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </button>

      {expanded && (
        <div className={styles.profileEditor}>
          {/* ── System prompt ───────────────────── */}
          <div className={styles.profileEditorSection}>
            <label className={styles.profileEditorLabel}>
              <span className={styles.profileEditorLabelRow}>
                <strong>{t('settings.agentProfileSystemPrompt', { defaultValue: 'System Prompt' })}</strong>
                <em>{t('settings.agentProfileTokenCount', { count: tokenEstimate, defaultValue: '~{{count}} tokens' })}</em>
              </span>
            </label>
            <textarea
              className={styles.profileEditorTextarea}
              value={profile.systemPrompt}
              onChange={(e) => setProfile((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              placeholder={t('settings.agentProfileSystemPromptPlaceholder', {
                runtime: agent.name,
                defaultValue: `Instructions for ${agent.name}...`,
              })}
              rows={6}
            />
            <div className={styles.profileEditorCharCount}>
              {t('settings.agentProfileCharCount', {
                count: profile.systemPrompt.length,
                defaultValue: '{{count}} chars',
              })}
            </div>
          </div>

          {/* ── Tool toggles ────────────────────── */}
          <div className={styles.profileEditorSection}>
            <div className={styles.profileEditorLabelRow}>
              <strong>{t('settings.agentProfileTools', { defaultValue: 'Tool Permissions' })}</strong>
              <em>{t('settings.agentProfileToolsEnabled', { count: enabledToolCount, total: profile.tools.length, defaultValue: '{{count}}/{{total}} enabled' })}</em>
            </div>
            <div className={styles.profileToolGrid}>
              {profile.tools.map((tool, idx) => (
                <button
                  key={tool.name}
                  type="button"
                  className={`${styles.profileToolToggle} ${tool.enabled ? styles.profileToolToggleOn : ''}`}
                  onClick={() => toggleTool(idx)}
                  title={t(tool.description, { defaultValue: tool.description })}
                >
                  <span className={styles.profileToolCheck}>
                    {tool.enabled ? <span className={styles.profileToolCheckMark}>&#x2713;</span> : null}
                  </span>
                  <div className={styles.profileToolInfo}>
                    <strong>{tool.name}</strong>
                    <span>{t(tool.description, { defaultValue: tool.description })}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Web search toggle */}
          <div className={styles.profileEditorSection}>
            <div className={styles.profileEditorLabelRow}>
              <div>
                <strong>{t('settings.agentProfileWebSearch', { defaultValue: 'Web Search' })}</strong>
                <span>{t('settings.agentProfileWebSearchDesc', { defaultValue: 'Allow agent to search the web during execution' })}</span>
              </div>
              <button
                type="button"
                className={`${styles.switch} ${profile.webSearchEnabled ? styles.switchOn : ''}`}
                role="switch"
                aria-checked={profile.webSearchEnabled}
                onClick={() => setProfile((prev) => ({ ...prev, webSearchEnabled: !prev.webSearchEnabled }))}
              >
                <span />
              </button>
            </div>
          </div>

          {/* Model override */}
          <div className={styles.profileEditorSection}>
            <label className={styles.profileEditorLabelRow}>
              <strong>{t('settings.agentProfileModelOverride', { defaultValue: 'Model Override' })}</strong>
              <span>{t('settings.agentProfileModelOverrideDesc', { defaultValue: 'Leave empty to use global defaults' })}</span>
            </label>
            <div className={styles.profileEditorModelRow}>
              <label className={styles.profileEditorMiniLabel}>
                <span>{t('settings.modelAliasModel')}</span>
                <select
                  className={styles.select}
                  value={profile.modelOverride}
                  onChange={(e) => setProfile((prev) => ({ ...prev, modelOverride: e.target.value }))}
                >
                  <option value="">{t('settings.agentProfileUseDefault', { defaultValue: 'Use default' })}</option>
                  {MODEL_OPTIONS.filter(([v]) => v !== 'auto').map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.profileEditorMiniLabel}>
                <span>{t('settings.modelAliasProvider')}</span>
                <select
                  className={styles.select}
                  value={profile.providerOverride}
                  onChange={(e) => setProfile((prev) => ({ ...prev, providerOverride: e.target.value }))}
                >
                  <option value="">{t('settings.agentProfileUseDefault', { defaultValue: 'Use default' })}</option>
                  {PROVIDER_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.profileEditorMiniLabel}>
                <span>{t('settings.modelAliasReasoning')}</span>
                <select
                  className={styles.select}
                  value={profile.reasoningOverride}
                  onChange={(e) => setProfile((prev) => ({ ...prev, reasoningOverride: e.target.value }))}
                >
                  <option value="">{t('settings.agentProfileUseDefault', { defaultValue: 'Use default' })}</option>
                  {REASONING_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Model parameter sliders */}
          <div className={styles.profileEditorSection}>
            <div className={styles.profileEditorLabelRow}>
              <strong>{t('settings.agentProfileModelParams', { defaultValue: 'Model Parameters' })}</strong>
              <span>{t('settings.agentProfileModelParamsDesc', { defaultValue: 'Fine-tune generation behavior' })}</span>
            </div>
            <div className={styles.profileEditorSliders}>
              <label className={styles.profileEditorSliderLabel}>
                <div className={styles.profileEditorSliderHead}>
                  <span>{t('settings.agentProfileTemperature', { defaultValue: 'Temperature' })}</span>
                  <em>{profile.temperature.toFixed(2)}</em>
                </div>
                <input
                  type="range"
                  className={styles.profileEditorSlider}
                  min="0"
                  max="2"
                  step="0.01"
                  value={profile.temperature}
                  onChange={(e) => setProfile((prev) => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                />
                <span className={styles.profileEditorSliderHint}>
                  {t('settings.agentProfileTemperatureHint', { defaultValue: 'Lower = more deterministic, higher = more creative' })}
                </span>
              </label>
              <label className={styles.profileEditorSliderLabel}>
                <div className={styles.profileEditorSliderHead}>
                  <span>{t('settings.agentProfileTopP', { defaultValue: 'Top P' })}</span>
                  <em>{profile.topP.toFixed(2)}</em>
                </div>
                <input
                  type="range"
                  className={styles.profileEditorSlider}
                  min="0"
                  max="1"
                  step="0.01"
                  value={profile.topP}
                  onChange={(e) => setProfile((prev) => ({ ...prev, topP: parseFloat(e.target.value) }))}
                />
                <span className={styles.profileEditorSliderHint}>
                  {t('settings.agentProfileTopPHint', { defaultValue: 'Nucleus sampling — cumulative probability cutoff' })}
                </span>
              </label>
              <label className={styles.profileEditorSliderLabel}>
                <div className={styles.profileEditorSliderHead}>
                  <span>{t('settings.agentProfileMaxTokens', { defaultValue: 'Max Output Tokens' })}</span>
                  <em>{profile.maxOutputTokens.toLocaleString()}</em>
                </div>
                <input
                  type="range"
                  className={styles.profileEditorSlider}
                  min="256"
                  max="200000"
                  step="256"
                  value={profile.maxOutputTokens}
                  onChange={(e) => setProfile((prev) => ({ ...prev, maxOutputTokens: parseInt(e.target.value, 10) }))}
                />
                <span className={styles.profileEditorSliderHint}>
                  {t('settings.agentProfileMaxTokensHint', { defaultValue: 'Maximum tokens the model can generate in a single response' })}
                </span>
              </label>
            </div>
          </div>

          {/* MCP server attachments */}
          <div className={styles.profileEditorSection}>
            <div className={styles.profileEditorLabelRow}>
              <div>
                <strong>{t('settings.agentProfileMcpServers', { defaultValue: 'MCP Server Attachments' })}</strong>
                <span>{t('settings.agentProfileMcpServersDesc', { defaultValue: 'MCP server config files or URLs to attach to this profile' })}</span>
              </div>
              <button
                type="button"
                className={`${styles.secondaryBtn} ${styles.profileEditorAddBtn}`}
                onClick={addMcpServer}
              >
                + {t('settings.agentProfileAddServer', { defaultValue: 'Add' })}
              </button>
            </div>
            {profile.mcpServers.map((server, idx) => (
              <div key={idx} className={styles.profileEditorInputRow}>
                <input
                  className={styles.textInput}
                  value={server.url}
                  onChange={(e) => updateMcpServerUrl(idx, e.target.value)}
                  placeholder={t('settings.agentProfileMcpPlaceholder', { defaultValue: 'MCP config path or URL...' })}
                  disabled={!server.enabled}
                />
                <button
                  type="button"
                  className={`${styles.switch} ${server.enabled ? styles.switchOn : ''}`}
                  role="switch"
                  aria-checked={server.enabled}
                  aria-label={t('settings.agentProfileToggleServer', { defaultValue: 'Toggle server' })}
                  onClick={() => toggleMcpServer(idx)}
                >
                  <span />
                </button>
                <button
                  type="button"
                  className={`${styles.secondaryBtn} ${styles.profileEditorRemoveBtn}`}
                  onClick={() => removeMcpServer(idx)}
                  aria-label={t('settings.agentProfileRemove', { defaultValue: 'Remove' })}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          {/* ── Skill / knowledge base links ─────── */}
          <div className={styles.profileEditorSection}>
            <div className={styles.profileEditorLabelRow}>
              <div>
                <strong>{t('settings.agentProfileSkillLinks', { defaultValue: 'Skill / Knowledge Base Links' })}</strong>
                <span>{t('settings.agentProfileSkillLinksDesc', { defaultValue: 'Paths to skill directories or knowledge base files to include' })}</span>
              </div>
              <button
                type="button"
                className={`${styles.secondaryBtn} ${styles.profileEditorAddBtn}`}
                onClick={addSkillLink}
              >
                + {t('settings.agentProfileAddLink', { defaultValue: 'Add' })}
              </button>
            </div>
            {profile.skillLinks.map((link, idx) => (
              <div key={idx} className={styles.profileEditorInputRow}>
                <input
                  className={styles.textInput}
                  value={link}
                  onChange={(e) => updateSkillLink(idx, e.target.value)}
                  placeholder={t('settings.agentProfileSkillPlaceholder', { defaultValue: 'Skill path or knowledge base URI...' })}
                />
                <button
                  type="button"
                  className={`${styles.secondaryBtn} ${styles.profileEditorRemoveBtn}`}
                  onClick={() => removeSkillLink(idx)}
                  aria-label={t('settings.agentProfileRemove', { defaultValue: 'Remove' })}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          {/* ── Actions ─────────────────────────── */}
          <div className={styles.profileEditorActions}>
            <div className={styles.profileEditorActionsLeft}>
              <span className={styles.profileEditorSource}>
                {t('settings.agentProfileStorage', { defaultValue: 'Saved to localStorage' })}: {agentProfileKey(agent.id)}
              </span>
              <button
                type="button"
                className={`${styles.secondaryBtn} ${styles.profileEditorResetBtn}`}
                onClick={handleReset}
              >
                {t('settings.agentProfileResetDefaults', { defaultValue: 'Reset to defaults' })}
              </button>
            </div>
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.profileEditorSaveBtn}`}
              onClick={handleSave}
              disabled={!hasChanges}
            >
              {hasChanges
                ? t('settings.agentProfileSaveChanges', { defaultValue: 'Save Changes' })
                : t('settings.agentProfileSaved', { defaultValue: 'Saved' })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
