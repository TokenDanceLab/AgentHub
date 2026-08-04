import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContactsPane,
  ContactGroup,
  ContactMember,
  ServiceDesk,
} from './pages';
import {
  WORKBENCH_MOCK_CONTACT_GROUPS,
  WORKBENCH_MOCK_CONTACT_MEMBER_POOL,
  WORKBENCH_MOCK_CONTACT_MEMBERS,
  WORKBENCH_MOCK_CONTACT_SHORTCUTS,
  WORKBENCH_MOCK_EXTERNAL_CONTACTS,
  WORKBENCH_MOCK_PAGE_SIZE,
  WORKBENCH_MOCK_PENDING_CONTACTS,
  WORKBENCH_MOCK_SERVICE_DESKS,
  readMockCursorPage,
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
  /**
   * Whether more mock members are available on the internal pane (mock
   * data-layer cursor pagination, #1510). False when the parent supplies
   * `contacts` or the active pane has no paginated list.
   */
  hasMore: boolean;
  /** Whether a load-more page fetch is in flight. */
  loadingMore: boolean;
  /** Appends the next page of mock members; undefined when the parent owns
   *  the contacts data (route hook keeps the local mock pattern). */
  onLoadMore: (() => void) | undefined;
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
  const handleMemberClick = onStartConversation
    ? (member: ContactMember) => {
        onStartConversation({ name: member.name, id: member.id, kind: 'dm' });
      }
    : undefined;

  // ── Mock cursor pagination (#1510). The mock pool is larger than one page
  //    so the infinite-scroll path is exercised; the first page is loaded
  //    synchronously from the pool (no flash), loadMore appends the next page
  //    with an async cursor read. When the parent supplies `contacts` the
  //    route keeps parent-owned data and pagination is inert. ──
  const mockPaginationEnabled = contacts === undefined;
  const firstPage = useMemo(
    () => readMockCursorPage(WORKBENCH_MOCK_CONTACT_MEMBER_POOL, WORKBENCH_MOCK_PAGE_SIZE, undefined),
    [],
  );
  const [members, setMembers] = useState<ContactMember[]>(() => firstPage.items);
  const [hasMore, setHasMore] = useState(() => firstPage.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMoreRef = useRef(firstPage.hasMore);
  const loadingMoreRef = useRef(false);
  const pageCursorRef = useRef<string | undefined>(firstPage.nextCursor);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onLoadMore = useCallback(async () => {
    if (!mockPaginationEnabled || loadingMoreRef.current) return;
    if (!hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await readMockCursorPage(
        WORKBENCH_MOCK_CONTACT_MEMBER_POOL,
        WORKBENCH_MOCK_PAGE_SIZE,
        pageCursorRef.current,
      );
      if (!mountedRef.current) return;
      setMembers((current) => [...current, ...page.items]);
      pageCursorRef.current = page.nextCursor;
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [mockPaginationEnabled]);

  // Pagination only drives the internal members list; external/starred panes
  // are small static slices, so expose the flags only for the internal pane.
  const membersPaneActive = contactsPane === 'internal';
  const contactsData = useMemo<WorkbenchContactsData>(() => {
    if (contacts) return resolveContactsData(contacts);
    return {
      members,
      externalContacts: WORKBENCH_MOCK_EXTERNAL_CONTACTS,
      pendingContacts: WORKBENCH_MOCK_PENDING_CONTACTS,
      starredContacts: WORKBENCH_MOCK_CONTACT_MEMBERS.slice(0, 2),
      groups: WORKBENCH_MOCK_CONTACT_GROUPS,
      serviceDesks: WORKBENCH_MOCK_SERVICE_DESKS,
      recentShortcuts: WORKBENCH_MOCK_CONTACT_SHORTCUTS,
      orgName: 'TokenDance',
      orgInitials: 'TD',
    };
  }, [contacts, members]);

  return {
    contactsPane,
    setContactsPane,
    contactsData,
    handleMemberClick,
    contactsActions,
    hasMore: mockPaginationEnabled && membersPaneActive ? hasMore : false,
    loadingMore: mockPaginationEnabled && membersPaneActive ? loadingMore : false,
    onLoadMore: mockPaginationEnabled && membersPaneActive ? onLoadMore : undefined,
  };
}
