import React, { useMemo } from 'react';
import type { WorkbenchProfileSource } from './profileRegistry';
import { ProjectsPage } from './pages/ProjectsPage';
import type { WorkbenchProjectsRoute } from './useWorkbenchProjectsRoute';
import { buildProjectsPageProps } from './workbenchRoutesHelpers';

export interface WorkbenchProjectsRouteViewProps {
  projectsRoute: WorkbenchProjectsRoute;
  profiles: WorkbenchProfileSource[];
}

/** Thin projects route shell: pure props builder + ProjectsPage wiring. */
export function WorkbenchProjectsRouteView({
  projectsRoute,
  profiles,
}: WorkbenchProjectsRouteViewProps): React.ReactElement {
  const props = useMemo(
    () => buildProjectsPageProps(projectsRoute, profiles),
    [projectsRoute, profiles],
  );

  return <ProjectsPage {...props} />;
}
