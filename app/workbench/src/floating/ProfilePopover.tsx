import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@shared/ui/focusTrap';
import type {
  AccountMenuRow,
  AccountSpace,
  ProfileAction,
  ProfileMetaRow,
  ProfileVariant,
} from './ProfilePopoverHelpers';
import {
  applyProfilePopoverPosition,
  computeProfilePopoverPosition,
  PROFILE_POPOVER_WIDTH,
  profileDialogAriaLabel,
  profileVariantClass,
  shouldCloseProfilePopoverOnOutsideClick,
} from './ProfilePopoverHelpers';
import { AccountProfileBody, DefaultProfileBody } from './ProfilePopoverParts';
import styles from './ProfilePopover.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   ProfilePopover — floating profile / account menu host.

   Residual helpers/parts live in ProfilePopoverHelpers /
   ProfilePopoverParts (#743). CSS remains on ProfilePopover.module.css.
   No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

interface ProfilePopoverProps {
  name: string;
  subtitle?: string;
  avatar?: string;
  avatarColor?: string;
  avatarUrl?: string;
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchorElement?: HTMLElement | null;
  variant?: ProfileVariant;
  badge?: string;
  actions?: ProfileAction[];
  meta?: ProfileMetaRow[];
  /* ── Account variant ── */
  org?: string;
  status?: string;
  signature?: string;
  accountMenu?: AccountMenuRow[];
  spaces?: AccountSpace[];
  onAction?: (action: string) => void;
  onAccountMenu?: (action: string) => void;
  onStatusToggle?: () => void;
  onSignatureEdit?: () => void;
}

export function ProfilePopover({
  name,
  subtitle,
  avatar,
  avatarColor,
  avatarUrl,
  isOpen,
  onClose,
  anchorRef,
  anchorElement,
  variant = 'default',
  badge,
  actions,
  meta,
  org,
  status,
  accountMenu,
  onAction,
  onAccountMenu,
  onStatusToggle,
}: ProfilePopoverProps) {
  const popoverRef = useRef<HTMLElement>(null);
  // Focus trap: saves trigger, wraps Tab/Shift+Tab, returns focus on close.
  useFocusTrap(popoverRef, isOpen);

  const position = useCallback(() => {
    const popover = popoverRef.current;
    const anchor = anchorElement ?? anchorRef?.current;
    if (!popover || !anchor) return;

    // Width first so height measurement matches the previous host layout.
    popover.style.width = `${PROFILE_POPOVER_WIDTH}px`;
    const next = computeProfilePopoverPosition({
      anchorRect: anchor.getBoundingClientRect(),
      popoverHeight: popover.getBoundingClientRect().height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    applyProfilePopoverPosition(popover, next);
  }, [anchorElement, anchorRef, variant]);

  /* ── Position on open ── */
  useEffect(() => {
    if (!isOpen) return;
    position();
  }, [isOpen, position]);

  /* ── Close on Escape ── */
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  /* ── Close on outside click ── */
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (shouldCloseProfilePopoverOnOutsideClick(popoverRef.current, e.target)) {
        onClose();
      }
    }
    // Delay registration so the opening click doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const variantClass = profileVariantClass(variant, styles);
  const shellClassName = `${styles.popover} ${variantClass} ${isOpen ? styles.open : ''}`;
  const ariaLabel = profileDialogAriaLabel(name, variant);

  const body = variant === 'account'
    ? (
        <AccountProfileBody
          accountMenu={accountMenu}
          actions={actions}
          avatar={avatar}
          avatarColor={avatarColor}
          avatarUrl={avatarUrl}
          badge={badge}
          name={name}
          onAccountMenu={onAccountMenu}
          onAction={onAction}
          onStatusToggle={onStatusToggle}
          org={org}
          status={status}
        />
      )
    : (
        <DefaultProfileBody
          actions={actions}
          avatar={avatar}
          avatarColor={avatarColor}
          badge={badge}
          meta={meta}
          name={name}
          onAction={onAction}
          subtitle={subtitle}
        />
      );

  const popover = (
    <section
      ref={popoverRef}
      className={shellClassName}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
    >
      {body}
    </section>
  );

  // The workbench shell and sidebar deliberately clip their children. Keep
  // viewport-positioned profile menus outside those stacking contexts so the
  // visible menu is also the element that receives pointer events.
  return typeof document === 'undefined'
    ? popover
    : createPortal(popover, document.body);
}
