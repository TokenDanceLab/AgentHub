import { useTranslation } from 'react-i18next';
import { Users, CheckSquare, FileText, Activity, Shield } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { EmptyState, SectionHeader, ActivityCard } from '@shared/ui';
import { useState } from 'react';

function GroupWorkspacePage() {
  const { t } = useTranslation('groupWorkspace');

  const [memberFilter, setMemberFilter] = useState<string>('all');

  const mockMembers = [
    { id: '1', name: 'Alice', role: 'Owner', status: 'online' as const },
    { id: '2', name: 'Bob', role: 'Developer', status: 'busy' as const },
    { id: '3', name: 'Charlie', role: 'Reviewer', status: 'offline' as const },
  ];

  const mockTasks = [
    { id: '1', title: 'Update API schema', status: 'active' as const, owner: 'Bob' },
    { id: '2', title: 'Review PR #128', status: 'done' as const, owner: 'Alice' },
    { id: '3', title: 'Sync workspace files', status: 'queue' as const, owner: 'Charlie' },
  ];

  const filteredMembers = memberFilter === 'all' ? mockMembers : mockMembers.filter((m) => m.status === memberFilter);

  const onlineCount = mockMembers.filter((m) => m.status !== 'offline').length;
  const busyCount = mockMembers.filter((m) => m.status === 'busy').length;

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
          {t('sync.checklist.lastSyncDetail', { time: '2025-06-02 10:30' })}
        </ActivityCard>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <ActivityCard label={t('stat.membersOnline')} icon={<Users size={14} />}>
          {onlineCount}
        </ActivityCard>
        <ActivityCard label={t('stat.sharedTasks')} icon={<CheckSquare size={14} />}>
          {mockTasks.filter((t) => t.status === 'active').length} / {mockTasks.length}
        </ActivityCard>
        <ActivityCard label={t('stat.workspaceFiles')} icon={<FileText size={14} />}>
          12
        </ActivityCard>
        <ActivityCard label={t('sync.readiness')} icon={<Shield size={14} />}>
          78%
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
                border: '1px solid var(--color-border, #e2e8f0)',
                background: memberFilter === f ? 'var(--color-primary, #4f46e5)' : 'transparent',
                color: memberFilter === f ? '#fff' : 'var(--color-text, #1a1a2e)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {t(`member.filter.${f}`)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredMembers.map((member) => (
            <div
              key={member.id}
              style={{
                display: 'flex', alignItems: 'center', padding: 10,
                border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8,
                gap: 10,
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: member.status === 'offline' ? 'var(--color-muted, #94a3b8)' : 'var(--color-primary, #4f46e5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 600, fontSize: 14,
              }}>
                {member.name[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{member.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted, #64748b)' }}>{member.role}</div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 500,
                padding: '2px 8px', borderRadius: 10,
                background: member.status === 'online' ? 'rgba(34,197,94,0.15)' : member.status === 'busy' ? 'rgba(245,158,11,0.15)' : 'rgba(148,163,184,0.15)',
                color: member.status === 'online' ? '#16a34a' : member.status === 'busy' ? '#d97706' : '#64748b',
              }}>
                {t(`member.status.${member.status}`)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('task.board')}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {mockTasks.map((task) => (
            <div
              key={task.id}
              style={{
                flex: '1 1 250px', minWidth: 200, padding: 12,
                border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{task.title}</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted, #64748b)', marginBottom: 6 }}>
                {t('task.owner', { name: task.owner })}
              </div>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: task.status === 'active' ? 'rgba(59,130,246,0.15)' : task.status === 'done' ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)',
                color: task.status === 'active' ? '#2563eb' : task.status === 'done' ? '#16a34a' : '#64748b',
              }}>
                {t(`task.tag.${task.status === 'active' ? 'active' : task.status === 'done' ? 'done' : 'queue'}`)}
              </span>
            </div>
          ))}
        </div>
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
