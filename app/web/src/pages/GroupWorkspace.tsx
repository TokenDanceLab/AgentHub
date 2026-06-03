import { useTranslation } from 'react-i18next';
import { Users, CheckSquare, FileText, Activity, Shield } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { useHubAgentTeams } from '@/api/agentTeamQueries';
import { useHubSession } from '@/hooks/useHubSession';
import { EmptyState, SectionHeader, ActivityCard } from '@shared/ui';
import { useState, useMemo } from 'react';

function GroupWorkspacePage() {
  const { t } = useTranslation('groupWorkspace');
  const { hasSession } = useHubSession();

  const [memberFilter, setMemberFilter] = useState<string>('all');

  const { data: overview, isLoading } = useHubAgentTeams({ enabled: hasSession });

  const members = useMemo(() => {
    if (!overview?.selectedTeam?.members) return [];
    return overview.selectedTeam.members.map((m) => ({
      id: m.id,
      name: m.agent_profile_id ?? m.id.slice(0, 8),
      role: m.role,
      status: 'online' as const,
    }));
  }, [overview]);

  const tasks = useMemo(() => {
    if (!overview?.tasks) return [];
    return overview.tasks.map((t) => ({
      id: t.id,
      title: t.objective ?? t.id.slice(0, 8),
      status: (t.status === 'done' ? 'done' : t.status === 'running' || t.status === 'dispatched' ? 'active' : 'queue') as 'active' | 'done' | 'queue',
      owner: t.assignee_member_id ?? '',
    }));
  }, [overview]);

  const filteredMembers = memberFilter === 'all' ? members : members.filter((m) => m.status === memberFilter);

  const onlineCount = members.length;
  const activeTaskCount = tasks.filter((t) => t.status === 'active').length;

  if (!hasSession) {
    return (
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <SectionHeader
          title={t('header.title')}
          eyebrow={t('sidebar.brandSubtitle')}
        />
        <EmptyState
          title={t('confirm.ready')}
          description={t('locked.description')}
          icon={<Users size={24} />}
          titleLevel={3}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <SectionHeader
          title={t('header.title')}
          eyebrow={t('sidebar.brandSubtitle')}
        />
        <ActivityCard label={t('source.loadingSnapshot')} icon={<Activity size={16} />}>
          {t('source.loadingSnapshot')}
        </ActivityCard>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <SectionHeader
        title={t('header.title')}
        eyebrow={t('sidebar.brandSubtitle')}
      />

      <div style={{ marginTop: 12, marginBottom: 16 }}>
        <ActivityCard
          label={t('sync.title')}
          icon={<Activity size={16} />}
        >
          {overview?.selectedTeam
            ? t('sync.checklist.lastSyncDetail', { time: overview.selectedTeam.updated_at ?? '--' })
            : t('sync.checklist.notSynced')}
        </ActivityCard>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <ActivityCard label={t('stat.membersOnline')} icon={<Users size={14} />}>
          {onlineCount}
        </ActivityCard>
        <ActivityCard label={t('stat.sharedTasks')} icon={<CheckSquare size={14} />}>
          {activeTaskCount} / {tasks.length}
        </ActivityCard>
        <ActivityCard label={t('stat.workspaceFiles')} icon={<FileText size={14} />}>
          --
        </ActivityCard>
        <ActivityCard label={t('sync.readiness')} icon={<Shield size={14} />}>
          --
        </ActivityCard>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('sidebar.members')}</h3>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {(['all', 'online', 'busy', 'offline'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setMemberFilter(f)}
              style={{
                padding: '4px 12px',
                borderRadius: 14,
                border: '1px solid var(--color-border)',
                background: memberFilter === f ? 'var(--primary)' : 'transparent',
                color: memberFilter === f ? '#fff' : 'var(--text)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {t(`member.filter.${f}`)}
            </button>
          ))}
        </div>
        {filteredMembers.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('member.empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredMembers.map((member) => (
              <div
                key={member.id}
                style={{
                  display: 'flex', alignItems: 'center', padding: 10,
                  border: '1px solid var(--color-border)', borderRadius: 8,
                  gap: 10,
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'var(--primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 600, fontSize: 14,
                }}>
                  {member.name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{member.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{member.role}</div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 500,
                  padding: '2px 8px', borderRadius: 10,
                  background: 'var(--success-surface)',
                  color: 'var(--success)',
                }}>
                  {t(`member.status.${member.status}`)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('task.board')}</h3>
        {tasks.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('task.board.backlog')}</p>
        ) : (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {tasks.map((task) => (
              <div
                key={task.id}
                style={{
                  flex: '1 1 250px', minWidth: 200, padding: 12,
                  border: '1px solid var(--color-border)', borderRadius: 8,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{task.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  {t('task.owner', { name: task.owner })}
                </div>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: task.status === 'active' ? 'var(--info-surface)' : task.status === 'done' ? 'var(--success-surface)' : 'var(--muted-surface)',
                  color: task.status === 'active' ? 'var(--info)' : task.status === 'done' ? 'var(--success)' : 'var(--muted)',
                }}>
                  {t(`task.tag.${task.status}`)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GroupWorkspacePageInteractive() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <GroupWorkspacePage />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
