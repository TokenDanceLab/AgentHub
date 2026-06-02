import { useTranslation } from 'react-i18next';
import { FolderKanban, CheckSquare, FileText, Play, AlertTriangle, Search, Bell, Settings, User } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { EmptyState, SectionHeader, ActivityCard } from '@shared/ui';
import { useState } from 'react';

function ProjectPage() {
  const { t } = useTranslation('project');

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'files'>('overview');

  const mockTasks = [
    { id: '1', title: 'Set up CI pipeline', status: 'active' as const, owner: 'Alice', milestone: 'M1' },
    { id: '2', title: 'API documentation', status: 'done' as const, owner: 'Bob', milestone: 'M1' },
    { id: '3', title: 'OIDC integration', status: 'next' as const, owner: 'Charlie', milestone: 'M2' },
  ];

  const mockMilestones = [
    { id: 'm1', title: 'M1: Core Infrastructure', progress: 75, tasks: 6, done: 4 },
    { id: 'm2', title: 'M2: Authentication', progress: 30, tasks: 5, done: 1 },
  ];

  const mockRisks = [
    { id: 'r1', title: 'OIDC callback on Windows', status: 'open' as const, owner: 'Charlie' },
    { id: 'r2', title: 'WebSocket reconnection stability', status: 'reviewed' as const, owner: 'Alice' },
  ];

  const filteredTasks = searchQuery
    ? mockTasks.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.owner.toLowerCase().includes(searchQuery.toLowerCase()))
    : mockTasks;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <SectionHeader
            title="AgentHub Desktop"
            eyebrow={t('hero.eyebrow')}
          />
          <p style={{ fontSize: 12, color: 'var(--color-muted, #64748b)', marginTop: 4 }}>
            {t('hero.description')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--color-muted, #64748b)' }} />
            <input
              type="text"
              placeholder={t('header.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t('header.searchAria')}
              style={{
                padding: '6px 8px 6px 26px', border: '1px solid var(--color-border, #e2e8f0)',
                borderRadius: 6, fontSize: 12, width: 160,
              }}
            />
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} aria-label={t('header.notifications')}>
            <Bell size={16} />
          </button>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} aria-label={t('header.settings')}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <ActivityCard label={t('metrics.activeTasks')} icon={<CheckSquare size={14} />}>
          {mockTasks.filter((t) => t.status === 'active').length}
        </ActivityCard>
        <ActivityCard label={t('metrics.milestones')} icon={<FolderKanban size={14} />}>
          {mockMilestones.length}
        </ActivityCard>
        <ActivityCard label={t('metrics.sharedFiles')} icon={<FileText size={14} />}>
          23
        </ActivityCard>
        <ActivityCard label={t('metrics.dryRuns')} icon={<Play size={14} />}>
          8
        </ActivityCard>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          flex: 1, height: 8, borderRadius: 4, background: 'var(--color-border, #e2e8f0)',
          overflow: 'hidden',
        }}>
          <div style={{ width: '52%', height: '100%', borderRadius: 4, background: 'var(--color-primary, #4f46e5)' }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--color-muted, #64748b)' }}>52%</span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['overview', 'tasks', 'files'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
              background: activeTab === tab ? 'var(--color-primary, #4f46e5)' : 'var(--color-surface, #f1f5f9)',
              color: activeTab === tab ? '#fff' : 'var(--color-text, #1a1a2e)',
            }}
          >
            {t(`board.${tab === 'overview' ? 'overviewTitle' : tab === 'tasks' ? 'tasksTitle' : 'filesTitle'}`, {
              count: tab === 'overview' ? mockMilestones.length : tab === 'tasks' ? mockTasks.length : 23,
              files: 23,
              runs: 8,
            })}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('milestones.title')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {mockMilestones.map((m) => (
              <div key={m.id} style={{ padding: 12, border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{m.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-muted, #64748b)' }}>{m.progress}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--color-border, #e2e8f0)', overflow: 'hidden' }}>
                  <div style={{ width: `${m.progress}%`, height: '100%', borderRadius: 3, background: 'var(--color-success, #22c55e)' }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-muted, #64748b)', marginTop: 4 }}>
                  {m.done} / {m.tasks} tasks
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('risks.title')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mockRisks.map((r) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', padding: 10, gap: 10,
                border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8,
              }}>
                <AlertTriangle size={16} color={r.status === 'open' ? '#f59e0b' : '#22c55e'} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted, #64748b)' }}>{r.owner}</div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                  background: r.status === 'open' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
                  color: r.status === 'open' ? '#d97706' : '#16a34a',
                }}>
                  {t(`risks.${r.status === 'open' ? 'needsReview' : 'reviewed'}`)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'tasks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredTasks.length === 0 ? (
            <EmptyState title={t('tasks.emptyTitle')} description={t('tasks.emptyHint')} icon={<CheckSquare size={24} />} titleLevel={3} />
          ) : (
            filteredTasks.map((task) => (
              <div key={task.id} style={{
                display: 'flex', alignItems: 'center', padding: 12, gap: 12,
                border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8,
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 4,
                  border: `2px solid ${task.status === 'done' ? 'var(--color-success, #22c55e)' : 'var(--color-border, #e2e8f0)'}`,
                  background: task.status === 'done' ? 'var(--color-success, #22c55e)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {task.status === 'done' && <span style={{ color: '#fff', fontSize: 12 }}>&#10003;</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{task.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted, #64748b)' }}>{task.owner} &middot; {task.milestone}</div>
                </div>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: task.status === 'active' ? 'rgba(59,130,246,0.15)' : task.status === 'done' ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)',
                  color: task.status === 'active' ? '#2563eb' : task.status === 'done' ? '#16a34a' : '#64748b',
                }}>
                  {t(`status.${task.status === 'done' ? 'done' : task.status === 'active' ? 'inProgress' : 'next'}`)}
                </span>
              </div>
            ))
          )}
        </div>
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
