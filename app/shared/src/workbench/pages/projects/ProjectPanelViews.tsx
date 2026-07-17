/* ═══════════════════════════════════════════════════════════════════════
   Projects detail shell — ProjectDetail tab switch + overview layout.

   Residual extract from ProjectDetailViews for Phase 22 #618.
   Residual thin (Phase 23 #626): panels / tab bodies live in sibling
   modules (ProjectPanelParts, ProjectTabViews).
   Residual thin (#696): imports refactored — Announcement / FeedPanel
   moved to own files.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import type { WorkbenchDocumentPreview } from '../../documentPreview';
import type { WorkbenchProfileSource } from '../../profileRegistry';
import styles from '../ProjectsPage.module.css';
import { ProjectAnnouncement } from './ProjectAnnouncement';
import { ProjectFeedPanel } from './ProjectFeedPanel';
import {
  ArtifactsPanel,
  MembersCard,
  ProjectPreviewPanel,
  RunsPanel,
} from './ProjectPanelParts';
import {
  ArchiveTab,
  ArtifactsTab,
  RunsTab,
  SettingsTab,
} from './ProjectTabViews';
import type {
  ProjectArtifact,
  ProjectInfo,
  ProjectRun,
  ProjectTab,
} from './types';

export function ProjectDetail({
  project,
  activeTab,
  onEditAnnouncement,
  onRunClick,
  onArtifactClick,
  profiles,
  activePreview,
  onClosePreview,
}: {
  project: ProjectInfo;
  activeTab: ProjectTab;
  onEditAnnouncement?: ((projectId: string) => void) | undefined;
  onRunClick?: ((projectId: string, run: ProjectRun) => void) | undefined;
  onArtifactClick?: ((projectId: string, artifact: ProjectArtifact) => void) | undefined;
  profiles?: WorkbenchProfileSource[] | undefined;
  activePreview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
}) {
  switch (activeTab) {
    case 'runs':
      return <RunsTab project={project} profiles={profiles} onRunClick={onRunClick} />;
    case 'artifacts':
      return (
        <ArtifactsTab
          project={project}
          activePreview={activePreview}
          onArtifactClick={onArtifactClick}
          onClosePreview={onClosePreview}
        />
      );
    case 'archive':
      return <ArchiveTab project={project} />;
    case 'settings':
      return <SettingsTab project={project} profiles={profiles} />;
    case 'overview':
    default:
      break;
  }

  return (
    <div className={styles.detailLayout}>
      <ProjectAnnouncement
        text={project.announcement}
        onEdit={() => onEditAnnouncement?.(project.id)}
      />
      <MembersCard members={project.members} profiles={profiles} />
      <RunsPanel
        runs={project.runs}
        meta={project.meta}
        profiles={profiles}
        onRunClick={(run) => onRunClick?.(project.id, run)}
      />
      <ArtifactsPanel
        artifacts={project.artifacts}
        onArtifactClick={(a) => onArtifactClick?.(project.id, a)}
      />
      <ProjectFeedPanel feed={project.feed} />
      <ProjectPreviewPanel preview={activePreview} onClosePreview={onClosePreview} />
    </div>
  );
}
