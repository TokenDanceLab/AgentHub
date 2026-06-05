import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Bot, Search, Sparkles, Star } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { useAgentList } from '@/api/agentQueries';
import { useHubCustomAgents } from '@/hooks/useHubCustomAgents';
import { useHubSession } from '@/hooks/useHubSession';
import { EmptyState, SectionHeader, ActivityCard } from '@shared/ui';
import type { AgentInfo } from '@shared/types';

function AgentSquarePage() {
  const { t } = useTranslation('agentSquare');
  const { hasSession, token } = useHubSession();

  const { data: agentData } = useAgentList(true);
  const agents: AgentInfo[] = agentData?.items ?? [];

  const hubCustomAgents = useHubCustomAgents(token);
  const hubAgents = hubCustomAgents.source === 'hub' && hubCustomAgents.agents.length > 0
    ? hubCustomAgents.agents
    : [];

  const sourceDescription = useMemo(() => {
    if (hubCustomAgents.isLoading) return t('source.loading');
    if (hubCustomAgents.error) return t('source.errorDetail', { error: hubCustomAgents.error });
    if (!hasSession) return t('source.loginRequiredDetail');
    if (hubAgents.length > 0) return t('source.hubDetail');
    return t('source.catalogFallbackDetail');
  }, [hubCustomAgents, hasSession, t]);

  const displayAgents = hubAgents.length > 0
    ? hubAgents.map((a) => ({
        id: a.id ?? '',
        name: a.name ?? t('source.hub'),
        description: a.system_prompt ?? '',
        runtimeId: a.agent_type ?? '',
      }))
    : agents;

  const displayCount = displayAgents.length;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <SectionHeader
        title={t('header.title')}
        eyebrow={t('brand.subtitle')}
      />

      <div style={{ marginTop: 12, marginBottom: 16 }}>
        <ActivityCard
          label={t('source.catalogMock')}
          icon={<Bot size={16} />}
        >
          {sourceDescription}
        </ActivityCard>
      </div>

      <div style={{ marginTop: 12, marginBottom: 16, display: 'flex', gap: 8 }}>
        <ActivityCard label={t('stats.curated')} icon={<Sparkles size={14} />}>
          {displayCount}
        </ActivityCard>
        <ActivityCard label={t('stats.favorites')} icon={<Star size={14} />}>
          0
        </ActivityCard>
      </div>

      {displayCount === 0 ? (
        <EmptyState
          title={t('empty.noResults')}
          description={t('empty.description')}
          icon={<Search size={24} />}
          titleLevel={3}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {displayAgents.map((agent) => (
            <div
              key={agent.id}
              style={{
                border: '1px solid var(--color-border, #e2e8f0)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{agent.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-muted, #64748b)', marginTop: 4 }}>
                {t('card.available')} &middot; {agent.runtimeId ?? t('stats.curated')}
              </div>
              {agent.description && (
                <div style={{ fontSize: 12, marginTop: 6 }}>{agent.description}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentSquarePageInteractive() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AgentSquarePage />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
