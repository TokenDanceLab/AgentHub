import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TeamMemberList.module.css';

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

const ROLE_CLASS: Record<string, string> = {
  supervisor: styles.roleSupervisor!,
  executor: styles.roleExecutor!,
  reviewer: styles.roleReviewer!,
};

export const TeamMemberList: FC<TeamMemberListProps> = ({ members, loading, error }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className={styles.loading}>
        {t('teamRun.loading', 'Loading members...')}
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        {error}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className={styles.empty}>
        {t('teamRun.noMembers', 'No team members yet.')}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {members.map((member) => (
        <div key={member.memberId} className={styles.card}>
          <div className={styles.cardLeft}>
            <div className={styles.avatar}>
              {(member.displayName || '?').charAt(0).toUpperCase()}
            </div>
            <div className={styles.memberInfo}>
              <span className={styles.memberName}>
                {member.displayName || member.memberId.slice(0, 8)}
              </span>
              <span className={`${styles.roleBadge} ${ROLE_CLASS[member.role] ?? styles.roleDefault}`}>
                {t(`settings.teamMemberRole.${member.role}`, member.role)}
              </span>
            </div>
          </div>
          <div className={styles.cardRight}>
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
