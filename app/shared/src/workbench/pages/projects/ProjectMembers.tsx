/* ═══════════════════════════════════════════════════════════════════════
   ProjectMembers list — residual extract from ProjectPanelParts for #696.
   Uses ProjectMemberChip from ProjectPanelHelpers.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import type { WorkbenchProfileSource } from '../../profileRegistry';
import styles from '../ProjectsPage.module.css';
import { ProjectMemberChip } from './ProjectPanelHelpers';

export function ProjectMembers({
  members,
  profiles = [],
}: {
  members: string[];
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <div className={`${styles.memberChips} project-members`}>
      {members.map((name) => (
        <ProjectMemberChip key={name} name={name} profiles={profiles} />
      ))}
    </div>
  );
}
