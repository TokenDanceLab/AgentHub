import { useTranslation } from 'react-i18next';
import { FolderKanban, CheckSquare, FileText, Play, AlertTriangle, Search, User } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { useHubSession } from '@/hooks/useHubSession';
import { EmptyState, SectionHeader, ActivityCard } from '@shared/ui';
import { useState } from 'react';

function ProjectPage() {
  const { t } = useTranslation('project');
  const { hasSession } = useHubSession();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'files'>('overview');

  if (!hasSession) {
    return (
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <SectionHeader
          title="AgentHub Desktop"
          eyebrow={t('hero.eyebrow')}
        />
        <EmptyState
          title={t('locked.title')}
          description={t('locked.description')}
          icon={<User size={24} />}
          titleLevel={3}
        />
      </div>
    );
  }

  const activeTasks = 0;
  const milestones = 0;
  const sharedFiles = 0;
  const dryRuns = 0;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <SectionHeader
            title="AgentHub Desktop"
            eyebrow={t('hero.eyebrow')}
          />
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {t('hero.description')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--muted)' }} />
            <input
              type="text"
              placeholder={t('header.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t('header.searchAria')}
              style={{
                padding: '6px 8px 6px 26px', border: '1px solid var(--border)',
                borderRadius: 6, fontSize: 12, width: 160,
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <ActivityCard label={t('metrics.activeTasks')} icon={<CheckSquare size={14} />}>
          {activeTasks}
        </ActivityCard>
        <ActivityCard label={t('metrics.milestones')} icon={<FolderKanban size={14} />}>
          {milestones}
        </ActivityCard>
        <ActivityCard label={t('metrics.sharedFiles')} icon={<FileText size={14} />}>
          {sharedFiles}
        </ActivityCard>
        <ActivityCard label={t('metrics.dryRuns')} icon={<Play size={14} />}>
          {dryRuns}
        </ActivityCard>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          flex: 1, height: 8, borderRadius: 4, background: 'var(--border)',
          overflow: 'hidden',
        }}>
          <div style={{ width: '0%', height: '100%', borderRadius: 4, background: 'var(--primary)' }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>0%</span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['overview', 'tasks', 'files'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
              background: activeTab === tab ? 'var(--primary)' : 'var(--surface)',
              color: activeTab === tab ? '#fff' : 'var(--text)',
            }}
          >
            {t(`board.${tab === 'overview' ? 'overviewTitle' : tab === 'tasks' ? 'tasksTitle' : 'filesTitle'}`, {
              count: tab === 'overview' ? milestones : tab === 'tasks' ? activeTasks : sharedFiles,
            })}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('milestones.title')}</h3>
          <EmptyState
            title={t('overview.emptyTitle')}
            description={t('overview.emptyHint')}
            icon={<FolderKanban size={24} />}
            titleLevel={3}
          />
        </>
      )}

      {activeTab === 'tasks' && (
        <EmptyState
          title={t('tasks.emptyTitle')}
          description={t('tasks.emptyHint')}
          icon={<CheckSquare size={24} />}
          titleLevel={3}
        />
      )}

      {activeTab === 'files' && (
        <EmptyState
          title={t('files.emptyTitle')}
          description={t('files.emptyHint')}
          icon={<FileText size={24} />}
          titleLevel={3}
        />
      )}
    </div>
  );
}

export default function ProjectPageInteractive() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ProjectPage />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
