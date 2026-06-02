import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Search, Sparkles, Star } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { useAgentList } from '@/api/agentQueries';
import { useHubSession } from '@/hooks/useHubSession';
import { EmptyState, SectionHeader, ActivityCard } from '@shared/ui';
import type { AgentInfo } from '@shared/types';

function AgentSquarePage() {
  const { t } = useTranslation('agentSquare');
  const [hubError, setHubError] = useState<string | null>(null);
  const [hubLoading, setHubLoading] = useState(false);
  const { hasSession, token, hubBaseUrl } = useHubSession();

  const { data: agentData } = useAgentList(true);
  const agents: AgentInfo[] = agentData?.items ?? [];

  // Attempt Hub custom-agents fetch when session exists
  useEffect(() => {
    if (!token) return;
    setHubLoading(true);
    const controller = new AbortController();
    fetch(`${hubBaseUrl}/api/v1/custom-agents`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || body?.code !== 'OK') {
          throw new Error(body?.message || `HTTP ${res.status}`);
        }
        setHubError(null);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setHubError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => setHubLoading(false));

    return () => controller.abort();
  }, [token, hubBaseUrl]);

  const sourceDescription = useMemo(() => {
    if (hubLoading) return t('source.loading');
    if (hubError) return t('source.errorDetail', { error: hubError });
    if (!hasSession) return t('source.loginRequiredDetail');
    return t('source.hubDetail');
  }, [hubError, hasSession, hubLoading, t]);

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
          {agents.length}
        </ActivityCard>
        <ActivityCard label={t('stats.favorites')} icon={<Star size={14} />}>
          0
        </ActivityCard>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          title={t('empty.noResults')}
          description={t('empty.description')}
          icon={<Search size={24} />}
          titleLevel={3}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {agents.map((agent) => (
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
