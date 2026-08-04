/* ═══════════════════════════════════════════════════════════════════════
   Contacts page public types — extracted for Phase 17 strangler slice #561.
   ═══════════════════════════════════════════════════════════════════════ */

export interface FriendRequestRow {
  request_id: string;
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  message: string;
  created_at: string;
}

export interface HubContactRow {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  remark?: string;
  online: boolean;
  type: string;
}

export interface HubSearchResultRow {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  relationship: string;
}

export interface ContactMember {
  id: string;
  name: string;
  initials: string;
  tag?: string;
  org: string;
  status: string;
  capabilities?: string[];
}

export interface ContactGroup {
  id: string;
  name: string;
  initials: string;
  count: string;
  latestMessage: string;
}

export interface ServiceDesk {
  id: string;
  name: string;
  initials: string;
  description: string;
}

export type ContactsPane =
  | 'internal'
  | 'external'
  | 'new'
  | 'starred'
  | 'groups'
  | 'service';

export type ContactModalTab = 'qr' | 'link' | 'code' | 'phone';

/** Avatar popover payload for member / group / service rows. */
export type ContactProfile =
  | {
      id: string;
      kind: 'member';
      name: string;
      initials: string;
      subtitle: string;
      badge: string;
      meta: { label: string; value: string }[];
      anchor: HTMLElement;
    }
  | {
      id: string;
      kind: 'group';
      name: string;
      initials: string;
      subtitle: string;
      badge: string;
      meta: { label: string; value: string }[];
      anchor: HTMLElement;
    }
  | {
      id: string;
      kind: 'service';
      name: string;
      initials: string;
      subtitle: string;
      badge: string;
      meta: { label: string; value: string }[];
      anchor: HTMLElement;
    };

export interface ContactsPageProps {
  /** Currently active nav pane */
  activePane: ContactsPane;
  /** Called when user clicks a nav item */
  onPaneChange: (pane: ContactsPane) => void;

  /** Search query */
  searchQuery?: string;
  /** Called when search input changes */
  onSearchChange?: ((query: string) => void) | undefined;

  /** Organization name displayed in the org row */
  orgName: string;
  /** Organization initials for the logo */
  orgInitials: string;

  /** Internal members (used in internal / starred panes) */
  members: ContactMember[];
  /** External contacts (used in external pane) */
  externalContacts?: ContactMember[];
  /** Pending contact requests (used in "new" pane) */
  pendingContacts?: ContactMember[];
  /** Received friend requests from Hub API */
  friendRequests?: FriendRequestRow[];
  /** Sent friend requests from Hub API */
  sentRequests?: FriendRequestRow[];
  /** Hub contacts (from API) */
  hubContacts?: HubContactRow[];
  /** Search result from Hub user search */
  searchResult?: HubSearchResultRow | null;
  /** Whether a search is in progress */
  searchLoading?: boolean;
  /** Starred contacts (used in starred pane) */
  starredContacts?: ContactMember[];
  /** Groups (used in groups pane) */
  groups?: ContactGroup[];
  /** Service desks (used in service pane) */
  serviceDesks?: ServiceDesk[];

  /** Recent contact shortcuts shown in the bottom of the nav */
  recentShortcuts?: string[];

  /** Called when "add contact" / "invite" button is clicked */
  onAddContact?: (() => void) | undefined;
  /** Called when "create group" button is clicked */
  onCreateGroup?: (() => void) | undefined;
  /** Called when "new ticket" button is clicked */
  onNewTicket?: (() => void) | undefined;

  /** Called when a member row is clicked */
  onMemberClick?: ((member: ContactMember) => void) | undefined;
  /** Called when a group row is clicked */
  onGroupClick?: ((group: ContactGroup) => void) | undefined;
  /** Called when a service card is clicked */
  onServiceClick?: ((desk: ServiceDesk) => void) | undefined;

  // ── Modal props ──
  /** Whether the add-contact modal is open */
  modalOpen?: boolean;
  /** Called to close the modal */
  onModalClose?: (() => void) | undefined;
  /** Called when the invite invite link is copied */
  onCopyInvite?: (() => void) | undefined;
  /** Called when phone invite is submitted */
  onSendPhoneInvite?: ((countryCode: string, phone: string, note: string) => void) | undefined;

  // ── Hub mutation callbacks ──

  /** Called when user searches for a Hub user by ID or name */
  onSearchUser?: ((query: string) => Promise<unknown> | void) | undefined;
  /** Called when user sends a friend request */
  onSendFriendRequest?: ((userId: string, message?: string) => Promise<unknown> | void) | undefined;
  /** Called when user accepts a pending friend request */
  onAcceptRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  /** Called when user rejects a pending friend request */
  onRejectRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  /** Called when user removes a contact */
  onRemoveContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  /** Called when user blocks a contact */
  onBlockContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  /** Called when user updates a contact remark */
  onUpdateRemark?: ((userId: string, remark: string) => Promise<unknown> | void) | undefined;

  // ── Infinite scroll (T14 pattern; mock data-layer cursor pagination, #1510) ──
  /** Whether more contacts are available via pagination (pageCursor). */
  hasMore?: boolean | undefined;
  /** Whether a load-more page fetch is in flight. */
  loadingMore?: boolean | undefined;
  /** Triggered when the scroll sentinel enters the viewport (or fallback button). */
  onLoadMore?: (() => void) | undefined;
}
