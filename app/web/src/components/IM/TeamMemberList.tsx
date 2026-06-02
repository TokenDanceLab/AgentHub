import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, User, Wrench } from 'lucide-react';
import styles from './TeamMemberList.module.css';

export interface TeamMemberDisplay {
  memberId: string;
  agentProfileId?: string | undefined;
  role: string;
  displayName?: string | undefined;
  activeTasks: number;
  completedTasks: number;
}

interface TeamMemberListProps {
  members: TeamMemberDisplay[];
  loading: boolean;
  error: string | null;
}

const ROLE_CONFIG: Record<string, { icon: typeof Shield; labelKey: string; className: string }> = {
  supervisor: { icon: Shield, labelKey: 'teamRun.role.supervisor', className: 'roleSupervisor' },
  reviewer: { icon: Shield, labelKey: 'teamRun.role.reviewer', className: 'roleReviewer' },
  executor: { icon: Wrench, labelKey: 'teamRun.role.executor', className: 'roleExecutor' },
  worker: { icon: Wrench, labelKey: 'teamRun.role.worker', className: 'roleExecutor' },
};

function roleConfig(role: string) {
  return ROLE_CONFIG[role] ?? { icon: User, labelKey: 'teamRun.role.member', className: 'roleMember' };
}

function roleClass(role: string): string {
  const cls = roleConfig(role).className;
  return (styles as Record<string, string>)[cls] ?? (styles as Record<string, string>).roleMember ?? '';
}

export const TeamMemberList = memo(function TeamMemberList({ members, loading, error }: TeamMemberListProps) {
  const { t } = useTranslation();

  if (loading && members.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.hint}>{t('teamRun.loading', 'Loading...')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <User size={32} className={styles.emptyIcon} />
          <span>{t('teamRun.noMembers', 'No team members.')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {members.map((member) => {
        const config = roleConfig(member.role);
        const RoleIcon = config.icon;
        const totalTasks = member.activeTasks + member.completedTasks;
        return (
          <div key={member.memberId} className={styles.memberCard}>
            <div className={styles.memberAvatar}>
              <User size={20} />
            </div>
            <div className={styles.memberInfo}>
              <div className={styles.memberName}>
                {member.displayName ?? member.memberId.slice(0, 8)}
              </div>
              <span className={roleClass(member.role)}>
                <RoleIcon size={12} />
                {t(config.labelKey, member.role)}
              </span>
            </div>
            <div className={styles.memberStats}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{member.activeTasks}</span>
                <span className={styles.statLabel}>{t('teamRun.active', 'Active')}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{member.completedTasks}</span>
                <span className={styles.statLabel}>{t('teamRun.completed', 'Done')}</span>
              </div>
              {totalTasks > 0 && (
                <div className={styles.progress}>
                  <div
                    className={styles.progressFill}
                    style={{
                      width: `${totalTasks > 0 ? (member.completedTasks / totalTasks) * 100 : 0}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default TeamMemberList;
