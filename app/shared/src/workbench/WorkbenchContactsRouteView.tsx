import React, { useMemo } from 'react';
import { ContactsPage } from './pages/ContactsPage';
import type { WorkbenchContactsRoute } from './useWorkbenchContactsRoute';
import { buildContactsPageProps } from './workbenchRoutesHelpers';

export interface WorkbenchContactsRouteViewProps {
  contactsRoute: WorkbenchContactsRoute;
}

/** Thin contacts route shell: pure props builder + ContactsPage wiring. */
export function WorkbenchContactsRouteView({
  contactsRoute,
}: WorkbenchContactsRouteViewProps): React.ReactElement {
  const props = useMemo(
    () => buildContactsPageProps(contactsRoute),
    [contactsRoute],
  );

  return <ContactsPage {...props} />;
}
