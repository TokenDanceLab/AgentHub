/* ═══════════════════════════════════════════════════════════════════════
   ContactNav — frozen-input honesty gate (#2154 P1-1).

   The contacts shell is assembled without `onSearchChange`, which made the
   nav search box a frozen input: it looked editable and silently dropped
   every keystroke. AgentsPage already gated its own box with
   `disabled={!onSearchChange}`; ContactNav must do the same and say why.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../__tests__/setup';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { ContactNav, type ContactNavProps } from './ContactNav';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

function baseProps(overrides: Partial<ContactNavProps> = {}): ContactNavProps {
  return {
    activePane: 'internal',
    onPaneChange: () => undefined,
    orgName: 'TokenDance',
    orgInitials: 'TD',
    ...overrides,
  };
}

describe('ContactNav search gate (#2154 P1-1)', () => {
  it('disables the search input and states why when no handler is wired', () => {
    render(<ContactNav {...baseProps()} />);

    const input = screen.getByPlaceholderText('搜索联系人');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('title', '该搜索框还没有接入数据源，暂时不可用。');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('keeps a wired search input editable and forwards every keystroke', () => {
    const onSearchChange = vi.fn();
    render(<ContactNav {...baseProps({ searchQuery: '', onSearchChange })} />);

    const input = screen.getByPlaceholderText('搜索联系人');
    expect(input).toBeEnabled();
    // No "unavailable" hint when the box actually works.
    expect(input).not.toHaveAttribute('title');

    fireEvent.change(input, { target: { value: '张三' } });
    expect(onSearchChange).toHaveBeenCalledWith('张三');
  });
});
