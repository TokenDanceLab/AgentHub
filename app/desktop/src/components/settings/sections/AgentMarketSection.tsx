import { useTranslation } from 'react-i18next';
import {
  Bot, ShieldCheck, Code2, Globe2, RefreshCw, Plus,
  Search, Star, Download, Eye, X, Tag, Clock,
  ArrowLeft, Filter, SlidersHorizontal,
  Wrench, Cpu, Check, BookOpen, Sparkles,
} from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';
import type { AgentInfo } from '@shared/types';
import Panel from '../primitives/Panel';
import SummaryCard from '../primitives/SummaryCard';
import CapabilityCard from '../primitives/CapabilityCard';
import EmptyBlock from '../primitives/EmptyBlock';
import AuthGapBlock from '../primitives/AuthGapBlock';
import Callout from '../primitives/Callout';
import AgentMarketCard from '../cards/AgentMarketCard';
import CustomAgentCreator, { readCustomAgentDrafts } from '../cards/CustomAgentCreator';
import PublishAgentModal from '../cards/PublishAgentModal';
import type { PublishAgentPayload } from '../cards/PublishAgentModal';
import { deleteCustomAgent, loadCustomAgents } from '../agent-creation/agentStore';
import { agentTemplates, capabilityLabels } from '../agent-creation/agentTemplates';
import type { AgentTemplate } from '../agent-creation/agentCreationTypes';
import { countAgentCapabilities, statusLabelFromQuery, readUnknownString, readUnknownArray } from '../utils';
import styles from '../primitives/primitives.module.css';

export interface CustomAgentMarketItem {
  id: string;
  name: string;
  agentType: string;
  systemPrompt: string;
  capabilities: string[];
  source: string;
  updatedAt?: string;
}

// ── Community / Hub agent shape for marketplace browse ──
export interface CommunityAgentItem {
  id: string;
  name: string;
  author: string;
  description: string;
  systemPrompt: string;
  agentType: string;
  capabilities: string[];
  tools: string[];
  model: string;
  provider: string;
  rating: number;
  installs: number;
  version: string;
  runtimeRequired: string;
  createdAt: string;
  updatedAt: string;
  iconUrl?: string;
}

function normalizeCustomAgent(raw: Record<string, unknown>): CustomAgentMarketItem {
  const id = readUnknownString(raw.id) ?? readUnknownString(raw.agent_id) ?? readUnknownString(raw.custom_agent_id) ?? 'custom-agent';
  const capabilityTags = readUnknownArray(raw.capability_tags);
  return {
    id,
    name: readUnknownString(raw.name) ?? id,
    agentType: readUnknownString(raw.agent_type) ?? readUnknownString(raw.type) ?? 'custom',
    systemPrompt: readUnknownString(raw.system_prompt) ?? readUnknownString(raw.description) ?? '',
    capabilities: capabilityTags.length > 0 ? capabilityTags : readUnknownArray(raw.capabilities),
    source: '/web/custom-agents',
    updatedAt: readUnknownString(raw.updated_at) ?? readUnknownString(raw.created_at),
  };
}

// ── Community / Hub agent shape for marketplace browse ──
const MOCK_COMMUNITY_AGENTS: CommunityAgentItem[] = [];

const ALL_CAPABILITY_TAGS = Array.from(
  new Set(MOCK_COMMUNITY_AGENTS.flatMap((a) => a.capabilities)),
).sort();

const INSTALLED_AGENTS_STORAGE_KEY = 'agenthub-settings.installedCommunityAgents';

function readInstalledCommunityAgentIds(): string[] {
  try {
    const raw = localStorage.getItem(INSTALLED_AGENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toggleInstalledCommunityAgent(agentId: string): boolean {
  const current = readInstalledCommunityAgentIds();
  const exists = current.includes(agentId);
  const next = exists ? current.filter((id) => id !== agentId) : [...current, agentId];
  try {
    localStorage.setItem(INSTALLED_AGENTS_STORAGE_KEY, JSON.stringify(next));
  } catch { /* noop */ }
  return !exists;
}

interface AgentMarketSectionProps {
  hubSessionActive: boolean;
  agents: AgentInfo[];
  edgeOnline: boolean;
  customAgents: Record<string, unknown>[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
  onOpenAuth: () => void;
}

type MarketTab = 'browse' | 'myAgents';

export default function AgentMarketSection({
  hubSessionActive, agents, edgeOnline, customAgents: rawAgents,
  isLoading, isFetching, isError, isSuccess, refetch, onOpenAuth,
}: AgentMarketSectionProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<MarketTab>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCapabilityTags, setSelectedCapabilityTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [detailAgent, setDetailAgent] = useState<CommunityAgentItem | null>(null);
  const [installedIds, setInstalledIds] = useState<string[]>(readInstalledCommunityAgentIds);
  const [showCreator, setShowCreator] = useState(false);
  const [templateToUse, setTemplateToUse] = useState<AgentTemplate | null>(null);
  const [editAgentId, setEditAgentId] = useState<string | null>(null);
  const [localDraftsVersion, setLocalDraftsVersion] = useState(0);
  const [publishAgent, setPublishAgent] = useState<PublishAgentPayload | null>(null);

  const refreshLocalDrafts = useCallback(() => {
    setLocalDraftsVersion((v) => v + 1);
  }, []);

  const localCustomAgents = useMemo(() => {
    void localDraftsVersion;
    return readCustomAgentDrafts();
  }, [localDraftsVersion]);

  const customAgents = rawAgents.map(normalizeCustomAgent);
  const marketPublishReady = customAgents.length + localCustomAgents.length;
  const marketCapabilityCount = countAgentCapabilities(agents as unknown as { capabilities: Record<string, boolean | undefined> }[]);

  const marketSnapshotStatus = statusLabelFromQuery({
    signedIn: hubSessionActive, isLoading, isFetching, isError, isSuccess, t,
  });

  // ── Browse tab: filter community agents ──
  const filteredCommunityAgents = useMemo(() => {
    if (!hubSessionActive) return [];
    let results = MOCK_COMMUNITY_AGENTS;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      results = results.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.author.toLowerCase().includes(q) ||
        a.agentType.toLowerCase().includes(q) ||
        a.capabilities.some((c) => c.toLowerCase().includes(q)),
      );
    }
    if (selectedCapabilityTags.length > 0) {
      results = results.filter((a) =>
        selectedCapabilityTags.every((tag) => a.capabilities.includes(tag)),
      );
    }
    return results;
  }, [hubSessionActive, searchQuery, selectedCapabilityTags]);

  const installedCommunityAgents = useMemo(() => {
    return MOCK_COMMUNITY_AGENTS.filter((a) => installedIds.includes(a.id));
  }, [installedIds]);

  const handleInstall = useCallback((agent: CommunityAgentItem) => {
    const added = toggleInstalledCommunityAgent(agent.id);
    setInstalledIds((prev) => {
      if (added) return [...prev, agent.id];
      return prev.filter((id) => id !== agent.id);
    });
    if (added) {
      // Clone agent config as a local custom agent draft
      const existing = readCustomAgentDrafts();
      const now = new Date().toISOString();
      const existingIdx = existing.findIndex((a) => a.id === agent.id);
      if (existingIdx < 0) {
        const item: CustomAgentMarketItem = {
          id: agent.id,
          name: agent.name,
          agentType: agent.agentType,
          systemPrompt: agent.systemPrompt,
          capabilities: agent.capabilities,
          source: 'hub-community',
          updatedAt: now,
        };
        const updated = [...existing, item];
        try {
          localStorage.setItem('agenthub-settings.customAgentDrafts', JSON.stringify(updated));
        } catch { /* noop */ }
      }
    }
  }, []);

  const handleUninstall = useCallback((agentId: string) => {
    toggleInstalledCommunityAgent(agentId);
    setInstalledIds((prev) => prev.filter((id) => id !== agentId));
  }, []);

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedCapabilityTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCapabilityTags([]);
  }, []);

  const hasActiveFilters = searchQuery.trim().length > 0 || selectedCapabilityTags.length > 0;

  const handleDeleteDraft = useCallback((agentId: string) => {
    deleteCustomAgent(agentId);
    refreshLocalDrafts();
  }, [refreshLocalDrafts]);

  const handleEditDraft = useCallback((agentId: string) => {
    const allAgents = loadCustomAgents();
    const found = allAgents.find((a) => a.id === agentId);
    if (found) {
      setEditAgentId(found.id);
      setTemplateToUse(null);
      setShowCreator(true);
    }
  }, []);

  const buildPublishPayload = useCallback((agent: CustomAgentMarketItem): PublishAgentPayload => {
    const allAgents = loadCustomAgents();
    const found = allAgents.find((a) => a.id === agent.id);
    return {
      id: agent.id,
      name: agent.name,
      description: found?.description ?? '',
      agentType: agent.agentType,
      systemPrompt: agent.systemPrompt,
      capabilities: agent.capabilities,
      tools: found ? Object.entries(found.capabilities).filter(([, v]) => v).map(([k]) => k) : agent.capabilities,
      model: found?.model ?? 'deepseek-v4-flash',
      provider: 'tokendance-gateway',
      version: '1.0.0',
    };
  }, []);

  const handlePublishDraft = useCallback((agent: CustomAgentMarketItem) => {
    setPublishAgent(buildPublishPayload(agent));
  }, [buildPublishPayload]);

  const handlePublished = useCallback(() => {
    setPublishAgent(null);
    refreshLocalDrafts();
  }, [refreshLocalDrafts]);

  const publishedCount = useMemo(() => {
    try {
      const raw = localStorage.getItem('agenthub-settings.publishedAgents');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }, []);

  // ── Auth gate ──
  if (!hubSessionActive) {
    return (
      <Panel title={t('settings.agentMarket')} description={t('settings.agentMarketDesc')}>
        <AuthGapBlock title={t('settings.hubSignInRequired')} description={t('settings.marketSignedOutDesc')} actionLabel={t('settings.signIn')} onAction={onOpenAuth} />
        <div className={styles.summaryGrid}>
          <SummaryCard icon={<Bot size={18} />} label={t('settings.marketLocalProfiles')} value={`${agents.length}`} detail={edgeOnline ? t('settings.marketLocalProfilesDesc') : t('settings.edgeOffline')} />
          <SummaryCard icon={<Code2 size={18} />} label={t('settings.marketCapabilities')} value={`${marketCapabilityCount}`} detail={t('settings.marketCapabilitiesDesc')} />
        </div>
        {localCustomAgents.length > 0 && (
          <div className={styles.taskSection}>
            <div className={styles.taskSectionHeader}>
              <strong>{t('settings.marketInstalledProfiles')}</strong>
              <span>{t('settings.marketInstalledProfilesDesc')}</span>
            </div>
            <div className={styles.profileGrid}>
              {localCustomAgents.map((agent) => (
                <AgentMarketCard
                  key={`local-${agent.id}`}
                  agent={agent}
                  onEdit={handleEditDraft}
                  onDelete={handleDeleteDraft}
                  onPublish={handlePublishDraft}
                />
              ))}
            </div>
          </div>
        )}
        {publishAgent && (
          <PublishAgentModal
            agent={publishAgent}
            onClose={() => setPublishAgent(null)}
            onPublished={handlePublished}
          />
        )}
        <Callout title={t('settings.marketGuard')} body={t('settings.marketGuardDesc')} />
      </Panel>
    );
  }

  return (
    <Panel title={t('settings.agentMarket')} description={t('settings.agentMarketDesc')}>
      {showCreator && (
        <CustomAgentCreator
          agents={agents}
          onClose={() => { setShowCreator(false); setTemplateToUse(null); setEditAgentId(null); }}
          onSaved={() => { refreshLocalDrafts(); setEditAgentId(null); }}
          initialTemplate={templateToUse}
          editAgentId={editAgentId}
        />
      )}

      {/* Publish agent modal */}
      {publishAgent && (
        <PublishAgentModal
          agent={publishAgent}
          onClose={() => setPublishAgent(null)}
          onPublished={handlePublished}
        />
      )}

      {/* ──── Create Custom Agent CTA Bar ──── */}
      <div className={styles.marketCtaBar}>
        <div className={styles.marketCtaBarText}>
          <Sparkles size={16} />
          <span>{t('settings.agentCreator.ctaBarTitle')}</span>
        </div>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => { setTemplateToUse(null); setEditAgentId(null); setShowCreator(true); }}
        >
          <Plus size={15} />
          {t('settings.agentCreator.createBtn')}
        </button>
      </div>

      {/* ──── Tab bar ──── */}
      <div className={styles.marketTabBar}>
        <button
          type="button"
          className={`${styles.marketTab} ${activeTab === 'browse' ? styles.marketTabActive : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          <Globe2 size={15} />
          {t('settings.marketBrowse')}
        </button>
        <button
          type="button"
          className={`${styles.marketTab} ${activeTab === 'myAgents' ? styles.marketTabActive : ''}`}
          onClick={() => setActiveTab('myAgents')}
        >
          <Bot size={15} />
          {t('settings.marketMyAgents')}
        </button>
      </div>

      {/* ──── Summary row ──── */}
      <div className={styles.summaryGrid}>
        <SummaryCard icon={<Globe2 size={18} />} label={t('settings.marketHubSync')} value={marketSnapshotStatus} detail={t('settings.marketHubSyncDesc')} />
        <SummaryCard icon={<Bot size={18} />} label={t('settings.marketMyAgents')} value={`${installedCommunityAgents.length + localCustomAgents.length + customAgents.length}`} detail={t('settings.marketMyAgentsDesc')} />
        <SummaryCard icon={<ShieldCheck size={18} />} label={t('settings.marketPublishReady')} value={isLoading ? t('settings.loading') : `${marketPublishReady}`} detail={t('settings.marketPublishReadyDesc')} />
        <SummaryCard icon={<Code2 size={18} />} label={t('settings.marketCapabilities')} value={`${marketCapabilityCount}`} detail={t('settings.marketCapabilitiesDesc')} />
      </div>

      {/* ──── Browse Tab ──── */}
      {activeTab === 'browse' && (
        <>
          {/* Search + filter bar */}
          <div className={styles.marketToolbar}>
            <div className={styles.marketSearchWrap}>
              <Search size={15} />
              <input
                type="text"
                className={styles.marketSearchInput}
                placeholder={t('settings.marketSearchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className={styles.marketClearBtn} onClick={() => setSearchQuery('')} aria-label="Clear">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className={styles.marketToolbarActions}>
              <button
                type="button"
                className={`${styles.secondaryBtn} ${showTagFilter ? styles.marketFilterActive : ''}`}
                onClick={() => setShowTagFilter((v) => !v)}
              >
                <Filter size={14} />
                {t('settings.marketFilterByTag')}
                {selectedCapabilityTags.length > 0 && (
                  <span className={styles.marketTagBadge}>{selectedCapabilityTags.length}</span>
                )}
              </button>
              {hasActiveFilters && (
                <button type="button" className={styles.secondaryBtn} onClick={clearFilters}>
                  <X size={14} />
                  {t('settings.marketClearFilters')}
                </button>
              )}
            </div>
          </div>

          {/* Tag filter chips */}
          {showTagFilter && (
            <div className={styles.marketTagFilterPanel}>
              {ALL_CAPABILITY_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`${styles.marketTagChip} ${selectedCapabilityTags.includes(tag) ? styles.marketTagChipSelected : ''}`}
                  onClick={() => handleToggleTag(tag)}
                >
                  <Tag size={11} />
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Template Gallery */}
          <div className={styles.templateGallery}>
            <div className={styles.templateGalleryHeader}>
              <div>
                <h3>{t('settings.wizard.templateGallery')}</h3>
                <span>{t('settings.wizard.templateGalleryDesc')}</span>
              </div>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => { setTemplateToUse(null); setShowCreator(true); }}
              >
                <Sparkles size={14} />
                {t('settings.wizard.blankStart')}
              </button>
            </div>
            <div className={styles.templateGrid}>
              {agentTemplates.map((tmpl) => {
                const toolCount = Object.entries(tmpl.capabilities).filter(([, v]) => v).length;
                return (
                  <div
                    key={tmpl.id}
                    className={styles.templateCard}
                    onClick={() => { setTemplateToUse(tmpl); setShowCreator(true); }}
                  >
                    <div className={styles.templateCardTop}>
                      <span className={styles.templateCardEmoji}>{tmpl.emoji}</span>
                      <span className={styles.templateCardCategory}>{tmpl.category}</span>
                    </div>
                    <div className={styles.templateCardBody}>
                      <h4>{tmpl.name}</h4>
                      <p>{tmpl.description}</p>
                    </div>
                    <div className={styles.templateCardBottom}>
                      <div className={styles.templateCardTools}>
                        {Object.entries(tmpl.capabilities).filter(([, v]) => v).slice(0, 3).map(([key]) => (
                          <span key={key} className={styles.templateCardToolBadge}>{capabilityLabels[key] ?? key}</span>
                        ))}
                        {toolCount > 3 && (
                          <span className={styles.templateCardToolBadge}>+{toolCount - 3}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className={styles.templateUseBtn}
                        onClick={(e) => { e.stopPropagation(); setTemplateToUse(tmpl); setShowCreator(true); }}
                      >
                        <BookOpen size={11} />
                        {t('settings.wizard.useTemplate')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Community agent grid — Coming Soon */}
          <div className={styles.marketAgentGrid} style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', padding: '24px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--settings-muted)', background: 'var(--settings-chip-bg)', border: '1px solid var(--settings-chip-border)', padding: '2px 8px', borderRadius: 6, display: 'inline-block', marginBottom: 12 }}>
                {t('settings.marketComingSoon', 'Coming Soon')}
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--settings-text)' }}>
                {t('settings.marketComingSoonTitle', 'Community Agent Marketplace')}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--settings-muted)', maxWidth: 360 }}>
                {t('settings.marketComingSoonDesc', 'Browse and install community agents. Hub API integration is in progress.')}
              </p>
            </div>
          </div>
        </>
      )}

      {/* ──── My Agents Tab ──── */}
      {activeTab === 'myAgents' && (
        <>
          <div className={styles.taskSectionHeader}>
            <div className={styles.taskSectionTitleRow}>
              <div>
                <strong>{t('settings.marketMyAgents')}</strong>
                <span>{t('settings.marketMyAgentsDesc')}</span>
              </div>
              <div className={styles.taskSectionActions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => setShowCreator(true)}
                >
                  <Plus size={15} />
                  {t('settings.agentCreator.createBtn')}
                </button>
                <button type="button" className={styles.secondaryBtn} onClick={() => void refetch()} disabled={isFetching}>
                  <RefreshCw size={15} />
                  {isFetching ? t('settings.marketRefreshing') : t('settings.marketRefresh')}
                </button>
              </div>
            </div>
          </div>

          {/* Installed from community */}
          {installedCommunityAgents.length > 0 && (
            <>
              <div className={styles.marketSubSection}>
                <strong>{t('settings.marketInstalledFromCommunity')}</strong>
                <span>{t('settings.marketInstalledFromCommunityDesc')}</span>
              </div>
              <div className={styles.marketAgentGrid}>
                {installedCommunityAgents.map((agent) => (
                  <div key={`inst-${agent.id}`} className={`${styles.marketAgentCard} ${styles.marketAgentCardInstalled}`}>
                    <div className={styles.marketAgentCardHeader}>
                      <div className={styles.marketAgentIcon}>
                        <Download size={20} />
                      </div>
                      <div className={styles.marketAgentTitle}>
                        <strong>{agent.name}</strong>
                        <span>{agent.author}</span>
                      </div>
                    </div>
                    <p className={styles.marketAgentDesc}>{agent.description}</p>
                    <div className={styles.marketAgentActions}>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => setDetailAgent(agent)}
                      >
                        <Eye size={13} />
                        {t('settings.marketViewDetails')}
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => handleUninstall(agent.id)}
                      >
                        <X size={13} />
                        {t('settings.marketUninstall')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Local custom agent drafts */}
          {localCustomAgents.length > 0 && (
            <>
              <div className={styles.marketSubSection}>
                <strong>{t('settings.marketLocalDrafts')}</strong>
                <span>{t('settings.marketLocalDraftsDesc')}</span>
              </div>
              <div className={styles.profileGrid}>
                {localCustomAgents.map((agent) => (
                  <AgentMarketCard
                    key={`local-${agent.id}`}
                    agent={agent}
                    onEdit={handleEditDraft}
                    onDelete={handleDeleteDraft}
                    onPublish={handlePublishDraft}
                  />
                ))}
              </div>
            </>
          )}

          {/* Hub custom agents */}
          {customAgents.length > 0 && (
            <>
              <div className={styles.marketSubSection}>
                <strong>{t('settings.marketHubAgents')}</strong>
                <span>{t('settings.marketHubAgentsDesc')}</span>
              </div>
              <div className={styles.profileGrid}>
                {customAgents.map((agent) => (
                  <AgentMarketCard key={`market-${agent.id}`} agent={agent} />
                ))}
              </div>
            </>
          )}

          {installedCommunityAgents.length === 0 && localCustomAgents.length === 0 && customAgents.length === 0 && (
            <EmptyBlock title={t('settings.marketNoMyAgents')} description={t('settings.marketNoMyAgentsDesc')} />
          )}
        </>
      )}

      {/* ──── Release readiness ──── */}
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.marketReleaseReadiness')}</strong><span>{t('settings.marketReleaseReadinessDesc')}</span></div>
        <div className={styles.capabilityGrid}>
          <CapabilityCard title={t('settings.agentTemplates')} description={t('settings.agentTemplatesDesc')} status={localCustomAgents.length > 0 ? t('settings.statusReady') : t('settings.statusNeedsConfig')} />
          <CapabilityCard title={t('settings.agentCapabilityTags')} description={t('settings.agentCapabilityTagsDesc')} status={marketCapabilityCount > 0 ? t('settings.statusReady') : t('settings.statusPlanned')} />
          <CapabilityCard title={t('settings.agentReviewFlow')} description={t('settings.agentReviewFlowDesc')} status={publishedCount > 0 ? t('settings.statusInReview') : t('settings.statusReady')} />
          <CapabilityCard title={t('settings.marketTokenDancePublish')} description={t('settings.marketTokenDancePublishDesc')} status={hubSessionActive ? (publishedCount > 0 ? t('settings.statusPublished') : t('settings.statusReady')) : t('settings.statusLoginLocked')} />
        </div>
      </div>
      <Callout title={t('settings.marketGuard')} body={t('settings.marketGuardDesc')} />

      {/* ──── Agent detail modal ──── */}
      {detailAgent && (
        <div className={styles.marketDetailOverlay} onClick={() => setDetailAgent(null)}>
          <div className={styles.marketDetailDialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.marketDetailHeader}>
              <div className={styles.marketDetailHeadLeft}>
                <div className={styles.marketDetailIcon}>
                  <Bot size={20} />
                </div>
                <div>
                  <h2>{detailAgent.name}</h2>
                  <span>{t('settings.authorsBy', { author: detailAgent.author })}</span>
                </div>
              </div>
              <button type="button" className={styles.creatorCloseBtn} onClick={() => setDetailAgent(null)} aria-label={t('settings.agentCreator.close')}>
                <X size={18} />
              </button>
            </div>

            <div className={styles.marketDetailBody}>
              <div className={styles.marketDetailStats}>
                <div className={styles.marketDetailStat}>
                  <Star size={14} />
                  <strong>{detailAgent.rating}</strong>
                  <span>{t('settings.marketRating')}</span>
                </div>
                <div className={styles.marketDetailStat}>
                  <Download size={14} />
                  <strong>{detailAgent.installs.toLocaleString()}</strong>
                  <span>{t('settings.marketInstalls')}</span>
                </div>
                <div className={styles.marketDetailStat}>
                  <Clock size={14} />
                  <strong>v{detailAgent.version}</strong>
                  <span>{t('settings.marketVersion')}</span>
                </div>
                <div className={styles.marketDetailStat}>
                  <Cpu size={14} />
                  <strong>{detailAgent.model}</strong>
                  <span>{t('settings.marketModel')}</span>
                </div>
              </div>

              <div className={styles.marketDetailSection}>
                <strong>{t('settings.marketDescription')}</strong>
                <p>{detailAgent.description}</p>
              </div>

              <div className={styles.marketDetailSection}>
                <strong>{t('settings.agentCreator.promptTemplate')}</strong>
                <pre className={styles.marketDetailPrompt}>{detailAgent.systemPrompt}</pre>
              </div>

              <div className={styles.marketDetailSection}>
                <strong>{t('settings.agentCreator.tabTools')}</strong>
                <div className={styles.marketDetailTags}>
                  {detailAgent.tools.map((tool) => (
                    <span key={tool} className={styles.marketDetailChip}>
                      <Wrench size={11} />
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.marketDetailSection}>
                <strong>{t('settings.agentCapabilityTags')}</strong>
                <div className={styles.marketDetailTags}>
                  {detailAgent.capabilities.map((cap) => (
                    <span key={cap} className={styles.marketDetailChip}>
                      <Tag size={11} />
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.marketDetailSection}>
                <strong>{t('settings.marketCompatibility')}</strong>
                <span className={styles.marketDetailMeta}>{detailAgent.runtimeRequired} | {detailAgent.provider}</span>
              </div>
            </div>

            <div className={styles.marketDetailFooter}>
              <button type="button" className={styles.secondaryBtn} onClick={() => setDetailAgent(null)}>
                <ArrowLeft size={14} />
                {t('settings.marketBackToBrowse')}
              </button>
              <button
                type="button"
                className={installedIds.includes(detailAgent.id) ? styles.secondaryBtn : styles.primaryBtn}
                onClick={() => {
                  handleInstall(detailAgent);
                  setDetailAgent(null);
                }}
              >
                {installedIds.includes(detailAgent.id) ? (
                  <>
                    <Check size={14} />
                    {t('settings.marketInstalled')}
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    {t('settings.marketInstallNow')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
