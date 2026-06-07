/* ═══ Floating components barrel exports ═══ */

import type { ComponentProps } from 'react';

import { ContextMenu } from './ContextMenu';
import { MultiSelectBar } from './MultiSelectBar';
import { PersonPanel } from './PersonPanel';
import { ProfilePopover } from './ProfilePopover';
import { Toast } from './Toast';

export {
  ContextMenu,
  MultiSelectBar,
  PersonPanel,
  ProfilePopover,
  Toast,
};

export type { ContextMenuProps, ContextMenuItem } from './ContextMenu';
export type { MultiSelectBarProps, MultiSelectBarAction } from './MultiSelectBar';
export type { ToastProps } from './Toast';

// PersonPanel and ProfilePopover use inline prop types that are not exported.
// Derive them via ComponentProps for consumers that need them.
export type PersonPanelProps = ComponentProps<typeof PersonPanel>;
export type ProfilePopoverProps = ComponentProps<typeof ProfilePopover>;
