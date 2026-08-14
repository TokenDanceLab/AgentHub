import styles from '../ContactsPage.module.css';
import type { ContactProfile } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   ContactMainHelpers — pure residual slices from ContactMainParts (#672)
   and ContactMainSections (#707).

   Profile popover planners, empty-state class props, search keydown
   parsing, and exactOptionalPropertyTypes-safe FriendRequestCard prop
   builders. No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type ContactProfileAction = { label: string };

export type ContactProfileVariant = 'group' | 'default';

export type ContactEmptyStateClassProps = {
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
};

export type FriendRequestAsyncHandler = (
  requestId: string,
) => Promise<unknown> | void;

export type FriendRequestCardOptionalProps = {
  onAccept?: (requestId: string) => void;
  onReject?: (requestId: string) => void;
  loading?: boolean;
};

/** Primary + secondary action labels for the avatar ProfilePopover. */
export function contactProfileActions(profile: ContactProfile): ContactProfileAction[] {
  return [
    { label: profile.kind === 'group' ? '进入项目' : '发送消息' },
    { label: profile.kind === 'service' ? '帮助与客服' : '复制链接' },
  ];
}

/** Avatar gradient / role color for the avatar ProfilePopover. */
export function contactProfileAvatarColor(profile: ContactProfile): string {
  if (profile.kind === 'group') return 'var(--role-researcher)';
  if (profile.kind === 'service') return 'var(--role-deployer)';
  return 'linear-gradient(135deg, var(--td-plum), var(--td-moss))';
}

/** ProfilePopover variant — groups use the group chrome. */
export function contactProfileVariant(profile: ContactProfile): ContactProfileVariant {
  return profile.kind === 'group' ? 'group' : 'default';
}

/**
 * exactOptionalPropertyTypes-safe optional className props for the
 * new-contacts EmptyState. Only defined keys are present when CSS modules
 * expose the corresponding class.
 */
export function contactEmptyStateClassProps(
  css: typeof styles = styles,
): ContactEmptyStateClassProps {
  const props: ContactEmptyStateClassProps = {};
  if (css['contacts-empty-compact']) {
    props.className = css['contacts-empty-compact'];
  }
  if (css['contacts-empty-compact-content']) {
    props.contentClassName = css['contacts-empty-compact-content'];
  }
  if (css['contacts-empty-compact-title']) {
    props.titleClassName = css['contacts-empty-compact-title'];
  }
  return props;
}

/** Show the primary empty region when no received requests and no pending rows. */
export function shouldShowNewContactsEmpty(
  friendRequests: ReadonlyArray<unknown> | undefined | null,
  pendingContacts: ReadonlyArray<unknown>,
): boolean {
  return (!friendRequests || friendRequests.length === 0) && pendingContacts.length === 0;
}

/**
 * Parse a search submit from a keydown event. Returns the trimmed query on
 * Enter, or null when the key is not Enter / the input is blank.
 */
export function searchQueryFromKeyDown(event: {
  key: string;
  target: EventTarget | null;
}): string | null {
  if (event.key !== 'Enter') return null;
  const value = (event.target as HTMLInputElement | null)?.value?.trim() ?? '';
  return value || null;
}

/**
 * Wrap a Promise-returning friend-request handler to a void-return callback
 * so FriendRequestCard props stay exactOptionalPropertyTypes-safe (#672).
 */
export function wrapFriendRequestHandler(
  handler: FriendRequestAsyncHandler | undefined,
): ((requestId: string) => void) | undefined {
  if (handler === undefined) return undefined;
  return (requestId: string) => {
    void handler(requestId);
  };
}

/**
 * Build optional FriendRequestCard props without spreading
 * `loading?: boolean | undefined` (or undefined handlers). Only defined
 * keys are present (#672 / #707).
 */
export function friendRequestCardOptionalProps(options: {
  onAcceptRequest?: FriendRequestAsyncHandler | undefined;
  onRejectRequest?: FriendRequestAsyncHandler | undefined;
  actionLoading?: boolean | undefined;
}): FriendRequestCardOptionalProps {
  const props: FriendRequestCardOptionalProps = {};
  const accept = wrapFriendRequestHandler(options.onAcceptRequest);
  const reject = wrapFriendRequestHandler(options.onRejectRequest);
  if (accept) props.onAccept = accept;
  if (reject) props.onReject = reject;
  if (options.actionLoading !== undefined) props.loading = options.actionLoading;
  return props;
}
