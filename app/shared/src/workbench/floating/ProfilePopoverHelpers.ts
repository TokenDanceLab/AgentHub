/* ═══════════════════════════════════════════════════════════════════════
   ProfilePopoverHelpers — pure residual slices from ProfilePopover (#743).

   Variant/class resolvers, avatar/status text builders, and viewport
   position math. No React / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type ProfileVariant = 'default' | 'agent' | 'group' | 'account';

export interface ProfileAction {
  label: string;
  onClick?: () => void;
}

export interface ProfileMetaRow {
  label: string;
  value: string;
}

export type AccountMenuRow =
  | { divider: true }
  | {
    label: string;
    style?: 'normal' | 'danger';
    trail?: 'external' | null;
    divider?: false;
    onClick?: () => void;
  };

export interface AccountSpace {
  name: string;
  description: string;
}

export type ProfilePopoverCss = Record<string, string>;

export type ProfilePopoverRect = {
  top: number;
  left: number;
  right: number;
};

export type ProfilePopoverPosition = {
  left: number;
  top: number;
  width: number;
};

export const PROFILE_POPOVER_WIDTH = 352;
export const PROFILE_POPOVER_GAP = 10;
export const PROFILE_POPOVER_EDGE = 12;
export const PROFILE_POPOVER_FALLBACK_HEIGHT = 360;

/** CSS module variant class for the popover shell. */
export function profileVariantClass(
  variant: ProfileVariant,
  css: ProfilePopoverCss,
): string {
  if (variant === 'agent') return css.agent ?? '';
  if (variant === 'group') return css.group ?? '';
  if (variant === 'account') return css.account ?? '';
  return '';
}

/** Initials glyph when no remote avatar URL is supplied. */
export function profileInitials(avatar: string | undefined, name: string): string {
  return avatar || name.slice(0, 1).toUpperCase();
}

/**
 * Avatar background for non-image glyphs. Account variant clears the
 * background when an image URL is present so the photo is not tinted.
 */
export function profileAvatarBackground(
  avatarColor: string | undefined,
  options?: { clearWhenImage?: boolean | undefined; avatarUrl?: string | undefined },
): string | undefined {
  if (options?.clearWhenImage && options.avatarUrl) return undefined;
  return avatarColor || 'var(--td-plum)';
}

/** Account head secondary line: "org · status" with safe separators. */
export function accountOrgStatusText(
  org: string | undefined,
  status: string | undefined,
): string {
  const left = org ?? '';
  const right = status ?? '';
  if (left && right) return `${left} · ${right}`;
  return left || right;
}

/** Status chip label; empty/undefined falls back to 在线. */
export function accountStatusLabel(status: string | undefined): string {
  return status || '在线';
}

/** Aria label for the dialog shell by variant. */
export function profileDialogAriaLabel(
  name: string,
  variant: ProfileVariant,
): string {
  return variant === 'account' ? `${name} 账号菜单` : `${name} 资料卡`;
}

/**
 * Pure viewport placement for the fixed popover. Mirrors the previous
 * DOM-side math: prefer right of anchor, flip left when overflowing,
 * clamp to edges, and keep the box within the viewport vertically.
 */
export function computeProfilePopoverPosition(input: {
  anchorRect: ProfilePopoverRect;
  popoverHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number | undefined;
  popWidth?: number | undefined;
  edge?: number | undefined;
}): ProfilePopoverPosition {
  const gap = input.gap ?? PROFILE_POPOVER_GAP;
  const popWidth = input.popWidth ?? PROFILE_POPOVER_WIDTH;
  const edge = input.edge ?? PROFILE_POPOVER_EDGE;
  const { anchorRect, popoverHeight, viewportWidth, viewportHeight } = input;

  // Match prior host math: clamp measured height against viewport - 28.
  const measuredHeight = Math.min(
    popoverHeight || PROFILE_POPOVER_FALLBACK_HEIGHT,
    viewportHeight - 28,
  );

  let left = anchorRect.right + gap;
  if (left + popWidth > viewportWidth - edge) {
    left = anchorRect.left - popWidth - gap;
  }
  left = Math.max(edge, Math.min(left, viewportWidth - popWidth - edge));

  let top = anchorRect.top - 10;
  if (top + measuredHeight > viewportHeight - edge) {
    top = viewportHeight - measuredHeight - edge;
  }
  top = Math.max(edge, top);

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: popWidth,
  };
}

/** Apply a computed position onto a positioned HTMLElement. */
export function applyProfilePopoverPosition(
  popover: HTMLElement,
  position: ProfilePopoverPosition,
): void {
  popover.style.width = `${position.width}px`;
  popover.style.left = `${position.left}px`;
  popover.style.top = `${position.top}px`;
}

/** Whether an outside-click target should close the popover. */
export function shouldCloseProfilePopoverOnOutsideClick(
  popover: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  if (!popover || !(target instanceof Node)) return false;
  return !popover.contains(target);
}
