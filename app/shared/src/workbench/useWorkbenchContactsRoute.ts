import { useState } from 'react';
import type {
  ContactsPane,
  ContactGroup,
  ContactMember,
  ServiceDesk,
} from './pages';
import {
  WORKBENCH_MOCK_CONTACT_GROUPS,
  WORKBENCH_MOCK_CONTACT_MEMBERS,
  WORKBENCH_MOCK_CONTACT_SHORTCUTS,
  WORKBENCH_MOCK_EXTERNAL_CONTACTS,
  WORKBENCH_MOCK_PENDING_CONTACTS,
  WORKBENCH_MOCK_SERVICE_DESKS,
} from './mockData';

/** Contact mutation callbacks wired to Hub API. */
export interface WorkbenchContactsActions {
  onSearchUser?: ((query: string) => Promise<unknown> | void) | undefined;
  onSendFriendRequest?: ((userId: string, message?: string) => Promise<unknown> | void) | undefined;
  onAcceptRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  onRejectRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  onRemoveContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  onBlockContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  onUnblockContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  onUpdateRemark?: ((userId: string, remark: string) => Promise<unknown> | void) | undefined;
  onCreateGroup?: ((name: string, memberIds: string[]) => Promise<unknown> | void) | undefined;
}

export interface WorkbenchContactsData {
  members: ContactMember[];
  externalContacts?: ContactMember[] | undefined;
  pendingContacts?: ContactMember[] | undefined;
  starredContacts?: ContactMember[] | undefined;
  groups?: ContactGroup[] | undefined;
  serviceDesks?: ServiceDesk[] | undefined;
  recentShortcuts?: string[] | undefined;
  orgName?: string | undefined;
  orgInitials?: string | undefined;
}

export interface UseWorkbenchContactsRouteOptions {
  contacts?: WorkbenchContactsData | undefined;
  contactsActions?: WorkbenchContactsActions | undefined;
  onStartConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
}

export interface WorkbenchContactsRoute {
  contactsPane: ContactsPane;
  setContactsPane: (pane: ContactsPane) => void;
  contactsData: WorkbenchContactsData;
  handleMemberClick: ((member: ContactMember) => void) | undefined;
  contactsActions: WorkbenchContactsActions | undefined;
}

function resolveContactsData(contacts: WorkbenchContactsData | undefined): WorkbenchContactsData {
  return contacts ?? {
    members: WORKBENCH_MOCK_CONTACT_MEMBERS,
    externalContacts: WORKBENCH_MOCK_EXTERNAL_CONTACTS,
    pendingContacts: WORKBENCH_MOCK_PENDING_CONTACTS,
    starredContacts: WORKBENCH_MOCK_CONTACT_MEMBERS.slice(0, 2),
    groups: WORKBENCH_MOCK_CONTACT_GROUPS,
    serviceDesks: WORKBENCH_MOCK_SERVICE_DESKS,
    recentShortcuts: WORKBENCH_MOCK_CONTACT_SHORTCUTS,
    orgName: 'TokenDance',
    orgInitials: 'TD',
  };
}

export function useWorkbenchContactsRoute({
  contacts,
  contactsActions,
  onStartConversation,
}: UseWorkbenchContactsRouteOptions): WorkbenchContactsRoute {
  const [contactsPane, setContactsPane] = useState<ContactsPane>('internal');
  const contactsData = resolveContactsData(contacts);
  const handleMemberClick = onStartConversation
    ? (member: ContactMember) => {
        onStartConversation({ name: member.name, id: member.id, kind: 'dm' });
      }
    : undefined;

  return {
    contactsPane,
    setContactsPane,
    contactsData,
    handleMemberClick,
    contactsActions,
  };
}
