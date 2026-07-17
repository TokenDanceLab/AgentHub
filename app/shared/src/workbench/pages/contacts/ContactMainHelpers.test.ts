import { describe, expect, it } from 'vitest';
import {
  contactEmptyStateClassProps,
  contactProfileActions,
  contactProfileAvatarColor,
  contactProfileVariant,
  searchQueryFromKeyDown,
  shouldShowNewContactsEmpty,
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
      'linear-gradient(135deg, var(--primary), var(--success))',
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
});
