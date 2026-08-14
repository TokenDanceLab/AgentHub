import { describe, expect, it, vi } from 'vitest';
import {
  contactEmptyStateClassProps,
  contactProfileActions,
  contactProfileAvatarColor,
  contactProfileVariant,
  friendRequestCardOptionalProps,
  searchQueryFromKeyDown,
  shouldShowNewContactsEmpty,
  wrapFriendRequestHandler,
} from './ContactMainHelpers';
import type { ContactProfile } from './types';

function makeProfile(kind: ContactProfile['kind']): ContactProfile {
  return {
    id: `${kind}-1`,
    kind,
    name: 'Sample',
    initials: 'SA',
    subtitle: 'sub',
    badge: 'badge',
    meta: [{ label: 'k', value: 'v' }],
    anchor: document.createElement('div'),
  };
}

describe('ContactMainHelpers', () => {
  it('plans profile popover actions by kind', () => {
    expect(contactProfileActions(makeProfile('member')).map((a) => a.label)).toEqual([
      '发送消息',
      '复制链接',
    ]);
    expect(contactProfileActions(makeProfile('group')).map((a) => a.label)).toEqual([
      '进入项目',
      '复制链接',
    ]);
    expect(contactProfileActions(makeProfile('service')).map((a) => a.label)).toEqual([
      '发送消息',
      '帮助与客服',
    ]);
  });

  it('plans avatar color and variant by kind', () => {
    expect(contactProfileAvatarColor(makeProfile('group'))).toBe('var(--role-researcher)');
    expect(contactProfileAvatarColor(makeProfile('service'))).toBe('var(--role-deployer)');
    expect(contactProfileAvatarColor(makeProfile('member'))).toBe(
      'linear-gradient(135deg, var(--td-plum), var(--td-moss))',
    );

    expect(contactProfileVariant(makeProfile('group'))).toBe('group');
    expect(contactProfileVariant(makeProfile('member'))).toBe('default');
    expect(contactProfileVariant(makeProfile('service'))).toBe('default');
  });

  it('builds exactOptionalPropertyTypes-safe empty-state class props', () => {
    const withClasses = contactEmptyStateClassProps({
      'contacts-empty-compact': 'c1',
      'contacts-empty-compact-content': 'c2',
      'contacts-empty-compact-title': 'c3',
    } as never);
    expect(withClasses).toEqual({
      className: 'c1',
      contentClassName: 'c2',
      titleClassName: 'c3',
    });

    const withoutClasses = contactEmptyStateClassProps({} as never);
    expect(withoutClasses).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(withoutClasses, 'className')).toBe(false);
  });

  it('decides when the new-contacts empty state should show', () => {
    expect(shouldShowNewContactsEmpty([], [])).toBe(true);
    expect(shouldShowNewContactsEmpty(undefined, [])).toBe(true);
    expect(shouldShowNewContactsEmpty(null, [])).toBe(true);
    expect(shouldShowNewContactsEmpty([{ id: 1 }], [])).toBe(false);
    expect(shouldShowNewContactsEmpty([], [{ id: 1 }])).toBe(false);
    expect(shouldShowNewContactsEmpty([{ id: 1 }], [{ id: 2 }])).toBe(false);
  });

  it('parses search submit queries from keydown events', () => {
    const input = document.createElement('input');
    input.value = '  alice  ';

    expect(searchQueryFromKeyDown({ key: 'Enter', target: input })).toBe('alice');
    expect(searchQueryFromKeyDown({ key: 'a', target: input })).toBeNull();

    input.value = '   ';
    expect(searchQueryFromKeyDown({ key: 'Enter', target: input })).toBeNull();
    expect(searchQueryFromKeyDown({ key: 'Enter', target: null })).toBeNull();
  });

  it('wraps async friend-request handlers to void-return callbacks', async () => {
    expect(wrapFriendRequestHandler(undefined)).toBeUndefined();

    const asyncHandler = vi.fn(async (_id: string) => 'ok');
    const wrapped = wrapFriendRequestHandler(asyncHandler);
    expect(wrapped).toBeTypeOf('function');
    expect(wrapped?.('req-1')).toBeUndefined();
    await Promise.resolve();
    expect(asyncHandler).toHaveBeenCalledWith('req-1');

    const syncHandler = vi.fn((_id: string) => undefined);
    wrapFriendRequestHandler(syncHandler)?.('req-2');
    expect(syncHandler).toHaveBeenCalledWith('req-2');
  });

  it('builds exactOptionalPropertyTypes-safe FriendRequestCard optional props', () => {
    const empty = friendRequestCardOptionalProps({});
    expect(empty).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(empty, 'loading')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(empty, 'onAccept')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(empty, 'onReject')).toBe(false);

    const loadingOnly = friendRequestCardOptionalProps({ actionLoading: false });
    expect(loadingOnly).toEqual({ loading: false });
    expect(Object.prototype.hasOwnProperty.call(loadingOnly, 'loading')).toBe(true);

    const accept = vi.fn(async () => undefined);
    const reject = vi.fn();
    const full = friendRequestCardOptionalProps({
      onAcceptRequest: accept,
      onRejectRequest: reject,
      actionLoading: true,
    });
    expect(Object.keys(full).sort()).toEqual(['loading', 'onAccept', 'onReject']);
    expect(full.loading).toBe(true);
    expect(full.onAccept?.('a')).toBeUndefined();
    expect(full.onReject?.('b')).toBeUndefined();
    expect(reject).toHaveBeenCalledWith('b');
  });
});
