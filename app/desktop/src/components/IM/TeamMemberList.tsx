import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

export interface TeamMemberDisplay {
  memberId: string;
  agentProfileId?: string;
  role: string;
  displayName: string;
  activeTasks: number;
  completedTasks: number;
  position?: number;
}

interface TeamMemberListProps {
  members: TeamMemberDisplay[];
  loading?: boolean;
  error?: string | null;
}

const ROLE_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  supervisor: { bg: '#fef3c7', text: '#92400e' },
  executor: { bg: '#dbeafe', text: '#1e40af' },
  reviewer: { bg: '#ede9fe', text: '#5b21b6' },
};

function roleBadgeStyle(role: string): React.CSSProperties {
  const colors = ROLE_BADGE_COLORS[role] ?? { bg: '#f3f4f6', text: '#374151' };
  return {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 9999,
    backgroundColor: colors.bg,
    color: colors.text,
    lineHeight: '18px',
    textTransform: 'capitalize',
  };
}

export const TeamMemberList: FC<TeamMemberListProps> = ({ members, loading, error }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
        {t('teamRun.loading', 'Loading members...')}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--color-danger, #e53e3e)', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
        {t('teamRun.noMembers', 'No team members yet.')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {members.map((member) => (
        <div
          key={member.memberId}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle, #e5e7eb)',
            backgroundColor: 'var(--surface-raised, #f9fafb)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: 'var(--color-primary, #3b82f6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {(member.displayName || '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {member.displayName || member.memberId.slice(0, 8)}
              </span>
              <span style={roleBadgeStyle(member.role)}>
                {t(`settings.teamMemberRole.${member.role}`, member.role)}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted-foreground)' }}>
            <span>
              {t('teamRun.activeTasks', 'Active: {{count}}', { count: member.activeTasks })}
            </span>
            <span>
              {t('teamRun.completedTasks', 'Done: {{count}}', { count: member.completedTasks })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};
