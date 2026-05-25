import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Braces,
  CheckCircle2,
  Cloud,
  Cpu,
  HardDrive,
  LockKeyhole,
  MessageSquareText,
  Route,
  Server,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import type { AgentInfo } from '@shared/types';
import styles from './WelcomeScreen.module.css';

interface Props {
  online: boolean;
  agents?: AgentInfo[];
  selectedAgentId?: string;
  onSelectAgent?: (agentId: string) => void;
  onCreateThread: () => void;
  onSendMessage: (message: string, agentId?: string, opts?: { model?: string }) => void;
}

const SUGGESTION_KEYS = [
  'welcome.suggestion1',
  'welcome.suggestion2',
  'welcome.suggestion3',
] as const;

type LauncherMode = 'runtime' | 'profile' | 'target';

export default memo(function WelcomeScreen({
  online,
  agents = [],
  selectedAgentId,
  onSelectAgent,
  onCreateThread,
  onSendMessage,
}: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeMode, setActiveMode] = useState<LauncherMode>('profile');
  const [draftAgentId, setDraftAgentId] = useState<string | undefined>();
  const resolveRunRequestOptions = useModelSettingsStore((s) => s.resolveRunRequestOptions);
  const defaultModel = useModelSettingsStore((s) => s.defaultModel);
  const defaultProvider = useModelSettingsStore((s) => s.defaultProvider);
  const modelMappingEnabled = useModelSettingsStore((s) => s.modelMappingEnabled);
  const providerFallbackEnabled = useModelSettingsStore((s) => s.providerFallbackEnabled);
  const reasoningEffort = useModelSettingsStore((s) => s.reasoningEffort);
  const aliases = useModelSettingsStore((s) => s.aliases);

  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.status === 'available'),
    [agents],
  );
  const activeAgent = useMemo(
    () =>
      agents.find((agent) => agent.id === draftAgentId) ??
      agents.find((agent) => agent.id === selectedAgentId) ??
      availableAgents[0] ??
      agents[0],
    [agents, availableAgents, draftAgentId, selectedAgentId],
  );
  const profileAlias = activeAgent ? preferredProfileAlias(activeAgent) : undefined;
  const route = useMemo(
    () => resolveRunRequestOptions({ model: profileAlias }),
    [
      aliases,
      defaultModel,
      defaultProvider,
      modelMappingEnabled,
      profileAlias,
      providerFallbackEnabled,
      reasoningEffort,
      resolveRunRequestOptions,
    ],
  );

  // Fade-in animation on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.opacity = '0';
    requestAnimationFrame(() => {
      el.style.transition = `opacity var(--duration-glacial) var(--ease-out)`;
      el.style.opacity = '1';
    });
  }, []);

  const handleSuggestionClick = (prompt: string) => {
    onCreateThread();
    onSendMessage(prompt, activeAgent?.id, profileAlias ? { model: profileAlias } : undefined);
  };

  const handleRuntimeSelect = (agentId: string) => {
    setDraftAgentId(agentId);
    onSelectAgent?.(agentId);
    setActiveMode('profile');
  };

  return (
    <div ref={containerRef} className={styles.container} role="region" aria-label={t('welcome.title')}>
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.brandMark} aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <span>{t('welcome.eyebrow')}</span>
          <h1>{t('welcome.headline')}</h1>
        </div>

        <div className={styles.launcher}>
          <div className={styles.modeRow} aria-label={t('welcome.launcherLabel')}>
            <button
              type="button"
              className={`${styles.modePill} ${activeMode === 'runtime' ? styles.modePillActive : ''}`}
              aria-pressed={activeMode === 'runtime'}
              onClick={() => setActiveMode('runtime')}
            >
              <Cpu size={15} />
              <span>{t('welcome.runtime')}</span>
            </button>
            <button
              type="button"
              className={`${styles.modePill} ${activeMode === 'profile' ? styles.modePillActive : ''}`}
              aria-pressed={activeMode === 'profile'}
              onClick={() => setActiveMode('profile')}
            >
              <Bot size={15} />
              <span>{t('welcome.profile')}</span>
            </button>
            <button
              type="button"
              className={`${styles.modePill} ${activeMode === 'target' ? styles.modePillActive : ''}`}
              aria-pressed={activeMode === 'target'}
              onClick={() => setActiveMode('target')}
            >
              <Route size={15} />
              <span>{t('welcome.target')}</span>
            </button>
          </div>

          <div className={styles.dispatchPanel}>
            {activeMode === 'runtime' && (
              <div className={styles.runtimeList} aria-label={t('welcome.runtimeList')}>
                {agents.length > 0 ? (
                  agents.slice(0, 4).map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={`${styles.runtimeItem} ${agent.id === activeAgent?.id ? styles.runtimeItemActive : ''}`}
                      onClick={() => handleRuntimeSelect(agent.id)}
                      disabled={agent.status !== 'available'}
                      aria-pressed={agent.id === activeAgent?.id}
                    >
                      <span className={styles.runtimeIcon}><Bot size={16} /></span>
                      <span className={styles.runtimeText}>
                        <strong>{agent.name}</strong>
                        <em>{agent.description || t('welcome.runtimeDefaultDesc')}</em>
                      </span>
                      <span className={`${styles.statusBadge} ${styles[`status_${agent.status}`]}`}>
                        {t(`agent.status.${agent.status}`)}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className={styles.emptyRuntime}>
                    {online ? <Wifi size={16} /> : <WifiOff size={16} />}
                    <span>{online ? t('welcome.noRuntimes') : t('welcome.edgeOffline')}</span>
                  </div>
                )}
              </div>
            )}

            {activeMode === 'profile' && (
              <div className={styles.profilePreview}>
                <div className={styles.profileTitle}>
                  <span className={styles.profileIcon}><Sparkles size={16} /></span>
                  <div>
                    <strong>{activeAgent ? t('welcome.profileName', { runtime: activeAgent.name }) : t('welcome.profileFallback')}</strong>
                    <em>{t('welcome.profileDesc')}</em>
                  </div>
                </div>
                <div className={styles.routeGrid}>
                  <Metric label={t('welcome.runtime')} value={activeAgent?.name ?? t('prompt.routeAuto')} />
                  <Metric label={t('welcome.profileAlias')} value={profileAlias ?? t('prompt.routeAuto')} />
                  <Metric label={t('welcome.model')} value={route.model ?? t('prompt.routeAuto')} />
                  <Metric label={t('welcome.provider')} value={route.provider ?? t('prompt.routeAuto')} />
                  <Metric label={t('welcome.reasoning')} value={route.reasoningEffort ?? t('prompt.routeAuto')} />
                  <Metric label={t('welcome.configSource')} value="AGENTS.md / skills / MCP" />
                </div>
              </div>
            )}

            {activeMode === 'target' && (
              <div className={styles.targetPreview}>
                <div className={styles.targetStatus}>
                  <span className={`${styles.targetDot} ${online ? styles.targetDotOnline : styles.targetDotOffline}`} />
                  <div>
                    <strong>{t('welcome.localEdgeTarget')}</strong>
                    <em>{online ? t('welcome.localEdgeReady') : t('welcome.edgeOffline')}</em>
                  </div>
                  <CheckCircle2 size={17} />
                </div>
                <div className={styles.targetGrid}>
                  <Metric label={t('welcome.execution')} value={t('settings.targetLocalEdge')} />
                  <Metric label={t('welcome.approval')} value={t('welcome.approvalAsk')} />
                  <Metric label={t('welcome.identity')} value={t('welcome.tokendance')} />
                  <Metric label={t('welcome.remoteReady')} value={t('settings.statusReady')} />
                </div>
              </div>
            )}
          </div>

          <button className={styles.commandBox} onClick={onCreateThread} type="button">
            <MessageSquareText size={19} />
            <span>
              {activeAgent
                ? t('welcome.commandPlaceholderForAgent', { runtime: activeAgent.name })
                : t('welcome.commandPlaceholder')}
            </span>
          </button>

          <div className={styles.controlRow}>
            <span><HardDrive size={14} />{online ? t('welcome.localEdge') : t('welcome.edgeOffline')}</span>
            <span><LockKeyhole size={14} />{t('welcome.approval')}</span>
            <span><Cloud size={14} />{t('welcome.tokendance')}</span>
            <span><Server size={14} />{availableAgents.length}/{agents.length || 0}</span>
          </div>
        </div>

        <div className={styles.suggestions}>
          <p className={styles.suggestionsLabel}>{t('welcome.suggestionsLabel')}</p>
          <div className={styles.chips}>
            {SUGGESTION_KEYS.map((key) => (
              <button
                key={key}
                className={styles.chip}
                onClick={() => handleSuggestionClick(t(key))}
                type="button"
              >
                <Braces size={14} />
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className={styles.metric}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function preferredProfileAlias(agent: AgentInfo) {
  const id = `${agent.id} ${agent.name}`.toLowerCase();
  if (id.includes('claude')) return 'opus';
  if (id.includes('codex')) return 'sonnet';
  if (id.includes('opencode') || id.includes('open-code')) return 'haiku';
  return undefined;
}
