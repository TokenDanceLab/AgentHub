import React, { useMemo } from 'react';
import type { WorkbenchProfileSource } from './profileRegistry';
import { DocsPage } from './pages/DocsPage';
import type { WorkbenchDocsRoute } from './useWorkbenchDocsRoute';
import { buildDocsPageProps } from './workbenchRoutesHelpers';

export interface WorkbenchDocsRouteViewProps {
  docsRoute: WorkbenchDocsRoute;
  profiles: WorkbenchProfileSource[];
}

/** Thin docs route shell: pure props builder + DocsPage wiring. */
export function WorkbenchDocsRouteView({
  docsRoute,
  profiles,
}: WorkbenchDocsRouteViewProps): React.ReactElement {
  const props = useMemo(
    () => buildDocsPageProps(docsRoute, profiles),
    [docsRoute, profiles],
  );

  return <DocsPage {...props} />;
}
