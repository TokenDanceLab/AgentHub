/* ═══════════════════════════════════════════════════════════════════════
   Shared render helpers extracted from ProjectPanelParts for #696.

   Residual thin: SectionHead deduplicates 12+ instances across
   ProjectPanelParts + ProjectTabViews; MemberChip deduplicates the
   duplicated member-chip JSX in MembersCard + ProjectMembers.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { DesignNavIcon, type DesignNavIconName } from '../../designIcons';
import {
  resolveWorkbenchProfile,
  type WorkbenchProfileSource,
} from '../../profileRegistry';
import styles from '../ProjectsPage.module.css';

export function ProjectSectionHead({
  icon,
  title,
  meta,
}: {
  icon: DesignNavIconName;
  title: string;
  meta: string;
}) {
  return (
    <div className={styles.sectionHead}>
      <h2>
        <DesignNavIcon name={icon} size={15} />{title}
      </h2>
      <span>{meta}</span>
    </div>
  );
}

export function ProjectMemberChip({
  name,
  profiles = [],
}: {
  name: string;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  const profile = resolveWorkbenchProfile(name, profiles);
  return (
    <span
      className={styles.memberChip}
      data-profile-kind={profile.kind}
      title={`${profile.name} · ${profile.label}`}
    >
      <span
        className={styles.memberAvatar}
        style={{ '--member-avatar-color': profile.color } as React.CSSProperties}
      >
        {profile.initials}
      </span>
      <span className={styles.memberName}>{profile.name}</span>
      <em className={styles.memberKind}>{profile.label}</em>
    </span>
  );
}
