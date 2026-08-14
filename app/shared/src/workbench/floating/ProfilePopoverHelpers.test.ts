import { describe, expect, it } from 'vitest';
import {
  accountOrgStatusText,
  accountStatusLabel,
  applyProfilePopoverPosition,
  computeProfilePopoverPosition,
  PROFILE_POPOVER_WIDTH,
  profileAvatarBackground,
  profileDialogAriaLabel,
  profileInitials,
  profileVariantClass,
  shouldCloseProfilePopoverOnOutsideClick,
} from './ProfilePopoverHelpers';

const css = {
  agent: 'agent-class',
  group: 'group-class',
  account: 'account-class',
};

describe('ProfilePopoverHelpers', () => {
  it('resolves variant CSS classes and dialog aria labels', () => {
    expect(profileVariantClass('default', css)).toBe('');
    expect(profileVariantClass('agent', css)).toBe('agent-class');
    expect(profileVariantClass('group', css)).toBe('group-class');
    expect(profileVariantClass('account', css)).toBe('account-class');
    expect(profileDialogAriaLabel('Ada', 'account')).toBe('Ada 账号菜单');
    expect(profileDialogAriaLabel('Ada', 'default')).toBe('Ada 资料卡');
    expect(profileDialogAriaLabel('Ada', 'agent')).toBe('Ada 资料卡');
  });

  it('builds initials and avatar backgrounds', () => {
    expect(profileInitials(undefined, 'alice')).toBe('A');
    expect(profileInitials('ZD', 'alice')).toBe('ZD');
    expect(profileAvatarBackground(undefined)).toBe('var(--td-plum)');
    expect(profileAvatarBackground('#123')).toBe('#123');
    expect(profileAvatarBackground('#123', {
      clearWhenImage: true,
      avatarUrl: 'https://example.com/a.png',
    })).toBeUndefined();
    expect(profileAvatarBackground('#123', {
      clearWhenImage: true,
    })).toBe('#123');
  });

  it('joins account org/status and status chip labels', () => {
    expect(accountOrgStatusText(undefined, undefined)).toBe('');
    expect(accountOrgStatusText('Org', undefined)).toBe('Org');
    expect(accountOrgStatusText(undefined, '在线')).toBe('在线');
    expect(accountOrgStatusText('Org', '忙碌')).toBe('Org · 忙碌');
    expect(accountStatusLabel(undefined)).toBe('在线');
    expect(accountStatusLabel('')).toBe('在线');
    expect(accountStatusLabel('离开')).toBe('离开');
  });

  it('places the popover to the right when space allows', () => {
    const pos = computeProfilePopoverPosition({
      anchorRect: { top: 100, left: 50, right: 90 },
      popoverHeight: 200,
      viewportWidth: 1200,
      viewportHeight: 800,
    });
    expect(pos.width).toBe(PROFILE_POPOVER_WIDTH);
    expect(pos.left).toBe(100);
    expect(pos.top).toBe(90);
  });

  it('flips left and clamps when overflowing the viewport', () => {
    const flipped = computeProfilePopoverPosition({
      anchorRect: { top: 40, left: 900, right: 980 },
      popoverHeight: 200,
      viewportWidth: 1000,
      viewportHeight: 600,
    });
    expect(flipped.left).toBe(900 - PROFILE_POPOVER_WIDTH - 10);
    expect(flipped.top).toBe(30);

    const tall = computeProfilePopoverPosition({
      anchorRect: { top: 500, left: 20, right: 60 },
      popoverHeight: 400,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(tall.top).toBe(600 - 400 - 12);

    const topClamped = computeProfilePopoverPosition({
      anchorRect: { top: 5, left: 20, right: 60 },
      popoverHeight: 100,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(topClamped.top).toBe(12);
  });

  it('applies position styles onto a DOM node', () => {
    const el = document.createElement('div');
    applyProfilePopoverPosition(el, { left: 12, top: 24, width: 352 });
    expect(el.style.width).toBe('352px');
    expect(el.style.left).toBe('12px');
    expect(el.style.top).toBe('24px');
  });

  it('detects outside clicks that should close the popover', () => {
    const popover = document.createElement('div');
    const inside = document.createElement('button');
    const outside = document.createElement('span');
    popover.appendChild(inside);
    document.body.append(popover, outside);

    expect(shouldCloseProfilePopoverOnOutsideClick(null, outside)).toBe(false);
    expect(shouldCloseProfilePopoverOnOutsideClick(popover, inside)).toBe(false);
    expect(shouldCloseProfilePopoverOnOutsideClick(popover, outside)).toBe(true);
    expect(shouldCloseProfilePopoverOnOutsideClick(popover, null)).toBe(false);

    popover.remove();
    outside.remove();
  });
});
