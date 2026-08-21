import React from 'react';
import { ProfilePopover } from './floating';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import {
  agentStateLabel,
  type AgentProfileState,
  type GroupProfileState,
  type HumanProfileState,
} from './useWorkbenchProfileChrome';

export interface WorkbenchProfileOverlaysProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  activeAgentProfile: AgentProfileState | null;
  activeHumanProfile: HumanProfileState | null;
  activeGroupProfile: GroupProfileState | null;
  onCloseAgentProfile: () => void;
  onCloseHumanProfile: () => void;
  onCloseGroupProfile: () => void;
  onAgentDirectMessage: () => void;
  onAgentConfig: () => void;
  onHumanDirectMessage: () => void;
  onCopyHumanProfileLink: () => void;
  onGroupSendMessage: () => void;
}

export function WorkbenchProfileOverlays({
  t,
  activeAgentProfile,
  activeHumanProfile,
  activeGroupProfile,
  onCloseAgentProfile,
  onCloseHumanProfile,
  onCloseGroupProfile,
  onAgentDirectMessage,
  onAgentConfig,
  onHumanDirectMessage,
  onCopyHumanProfileLink,
  onGroupSendMessage,
}: WorkbenchProfileOverlaysProps): React.ReactElement {
  return (
    <>
      {activeAgentProfile && (
        <ProfilePopover
          actions={[
            { label: t('profile.sendMessage') },
            { label: t('profile.agentConfig') },
          ]}
          anchorElement={activeAgentProfile.anchor}
          avatar={workbenchProfileInitials(activeAgentProfile.name)}
          avatarColor={workbenchAgentColor(activeAgentProfile)}
          badge={agentStateLabel(t, activeAgentProfile.state)}
          isOpen
          meta={[
            { label: t('profile.role'), value: activeAgentProfile.role },
            { label: t('profile.engine'), value: activeAgentProfile.engine },
            { label: t('profile.model'), value: activeAgentProfile.model },
            { label: t('profile.skills'), value: activeAgentProfile.skills.join(' · ') || t('status.unconfigured') },
          ]}
          name={activeAgentProfile.name}
          onAction={(action) => {
            if (action === t('profile.sendMessage')) onAgentDirectMessage();
            if (action === t('profile.agentConfig')) onAgentConfig();
          }}
          onClose={onCloseAgentProfile}
          subtitle={`${activeAgentProfile.role} · ${activeAgentProfile.engine}`}
          variant="agent"
        />
      )}
      {activeHumanProfile && (
        <ProfilePopover
          actions={[
            { label: t('profile.sendMessage') },
            { label: t('profile.copyLink') },
          ]}
          anchorElement={activeHumanProfile.anchor}
          avatar={activeHumanProfile.initials}
          avatarColor={activeHumanProfile.avatarColor ?? 'var(--surface-highest)'}
          badge={activeHumanProfile.tag}
          isOpen
          meta={[
            { label: t('profile.identity'), value: activeHumanProfile.tag },
            { label: t('profile.org'), value: activeHumanProfile.org },
            { label: t('profile.state'), value: activeHumanProfile.status },
            { label: t('profile.recentMessage'), value: activeHumanProfile.subtitle },
          ]}
          name={activeHumanProfile.name}
          onAction={(action) => {
            if (action === t('profile.sendMessage')) onHumanDirectMessage();
            if (action === t('profile.copyLink')) onCopyHumanProfileLink();
          }}
          onClose={onCloseHumanProfile}
          subtitle={`${activeHumanProfile.tag} · ${activeHumanProfile.org}`}
        />
      )}
      {activeGroupProfile && (
        <ProfilePopover
          actions={[
            { label: t('profile.sendMessage') },
          ]}
          anchorElement={activeGroupProfile.anchor}
          avatar={workbenchProfileInitials(activeGroupProfile.name)}
          avatarColor="var(--td-plum)"
          badge={t('profile.groupChat')}
          isOpen
          meta={[
            { label: t('profile.type'), value: t('profile.groupType') },
            ...(activeGroupProfile.memberNames.length > 0
              ? [{ label: t('profile.members'), value: activeGroupProfile.memberNames.join(' · ') }]
              : []),
          ]}
          name={activeGroupProfile.name}
          onAction={(action) => {
            if (action === t('profile.sendMessage')) onGroupSendMessage();
          }}
          onClose={onCloseGroupProfile}
          subtitle={activeGroupProfile.memberNames.length > 0
            ? `${activeGroupProfile.memberNames.length} ${t('profile.members').toLowerCase()}`
            : t('profile.groupSession')}
          variant="group"
        />
      )}
    </>
  );
}
