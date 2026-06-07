import { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react';
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
  SkipForward,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import type { AgentInfo } from '@shared/types';
import OnboardingStepper from './OnboardingStepper';
import styles from './WelcomeScreen.module.css';

interface Props {
  online: boolean;
  agents?: AgentInfo[];
  selectedAgentId?: string;
  onSelectAgent?: (agentId: string) => void;
  onCreateThread: () => void;
  onSendMessage: (message: string, agentId?: string, opts?: { model?: string }) => void;
}

const ONBOARDING_STORAGE_KEY = 'agenthub.onboarding.completed';
const SUGGESTION_KEYS = [
  'welcome.suggestion1',
  'welcome.suggestion2',
  'welcome.suggestion3',
] as const;

type LauncherMode = 'runtime' | 'profile' | 'target';

function isOnboardingCompleted(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function setOnboardingCompleted(): void {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  } catch {
    // localStorage may be unavailable
  }
}

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

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboardingCompleted());
  const [onboardingStep, setOnboardingStep] = useState(0);

  const onboardingSteps = useMemo(() => [
    { label: t('onboarding.step1', 'Select Runtime') },
    { label: t('onboarding.step2', 'Select Project') },
    { label: t('onboarding.step3', 'Send Message') },
  ], [t]);

  const resolveRunRequestOptions = useModelSettingsStore((s) => s.resolveRunRequestOptions);
  const defaultModel = useModelSettingsStore((s) => s.defaultModel);
  const defaultProvider = useModelSettingsStore((s) => s.defaultProvider);
  const modelMappingEnabled = useModelSettingsStore((s) => s.modelMappingEnabled);
  const providerFallbackEnabled = useModelSettingsStore((s) => s.providerFallbackEnabled);
  const reasoningEffort = useModelSettingsStore((s) => s.reasoningEffort);
  const aliases = useModelSettingsStore((s) => s.aliases);
  const routeSettingsKey = [
    defaultModel,
    defaultProvider,
    modelMappingEnabled,
    providerFallbackEnabled,
    reasoningEffort,
    aliases.map((alias) => `${alias.alias}:${alias.model}:${alias.provider}:${alias.reasoningEffort}:${alias.enabled}`).join(','),
  ].join('|');

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
  const route = useMemo(() => {
    void routeSettingsKey;
    return resolveRunRequestOptions(profileAlias ? { model: profileAlias } : {});
  }, [profileAlias, resolveRunRequestOptions, routeSettingsKey]);

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

  // Auto-advance onboarding step when agent is selected
  useEffect(() => {
    if (showOnboarding && onboardingStep === 0 && (selectedAgentId || draftAgentId)) {
      // Agent has been selected, advance to step 2
      setOnboardingStep(1);
    }
  }, [showOnboarding, onboardingStep, selectedAgentId, draftAgentId]);

  const handleSuggestionClick = (prompt: string) => {
    // Complete onboarding if active
    if (showOnboarding) {
      completeOnboarding();
    }
    onCreateThread();
    onSendMessage(prompt, activeAgent?.id, profileAlias ? { model: profileAlias } : undefined);
  };

  const handleRuntimeSelect = (agentId: string) => {
    setDraftAgentId(agentId);
    onSelectAgent?.(agentId);
    setActiveMode('profile');
    // Advance onboarding step if in onboarding mode
    if (showOnboarding && onboardingStep === 0) {
      setOnboardingStep(1);
    }
  };

  const completeOnboarding = useCallback(() => {
    setOnboardingCompleted();
    setShowOnboarding(false);
  }, []);

  const handleSkipOnboarding = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const handleOnboardingCreateThread = useCallback(() => {
    if (showOnboarding && onboardingStep === 1) {
      setOnboardingStep(2);
    }
    onCreateThread();
  }, [showOnboarding, onboardingStep, onCreateThread]);

  return (
    <div ref={containerRef} className={styles.container} role="region" aria-label={t('welcome.title')}>
      <div className={styles.content}>
        {showOnboarding && (
          <div className={styles.onboardingHeader}>
            <div className={styles.onboardingTitle}>
              <Sparkles size={16} />
              <span>{t('onboarding.title', 'Getting Started')}</span>
            </div>
            <OnboardingStepper steps={onboardingSteps} currentStep={onboardingStep} />
            <button
              type="button"
              className={styles.skipBtn}
              onClick={handleSkipOnboarding}
            >
              <SkipForward size={13} />
              <span>{t('onboarding.skip', 'Skip')}</span>
            </button>
          </div>
        )}

        <div className={styles.header}>
          <div className={styles.brandMark} aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <span>{t('welcome.eyebrow')}</span>
          <h1>
            {showOnboarding && onboardingStep === 0
              ? t('onboarding.step1Title', 'Choose your Agent Runtime')
              : showOnboarding && onboardingStep === 1
                ? t('onboarding.step2Title', 'Select or create a project')
                : showOnboarding && onboardingStep === 2
                  ? t('onboarding.step3Title', 'Send your first message')
                  : t('welcome.headline')}
          </h1>
          {showOnboarding && onboardingStep === 0 && (
            <p className={styles.onboardingHint}>{t('onboarding.step1Hint', 'Select a runtime to execute your agent tasks.')}</p>
          )}
          {showOnboarding && onboardingStep === 1 && (
            <p className={styles.onboardingHint}>{t('onboarding.step2Hint', 'Open a project folder or create a new thread to start working.')}</p>
          )}
          {showOnboarding && onboardingStep === 2 && (
            <p className={styles.onboardingHint}>{t('onboarding.step3Hint', 'Type a message below or click a suggestion to get started.')}</p>
          )}
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

          <button className={styles.commandBox} onClick={showOnboarding && onboardingStep === 1 ? handleOnboardingCreateThread : onCreateThread} type="button">
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
          <p className={styles.suggestionsLabel}>
            {showOnboarding && onboardingStep === 2
              ? t('onboarding.trySuggestion', 'Try one of these to get started:')
              : t('welcome.suggestionsLabel')}
          </p>
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
