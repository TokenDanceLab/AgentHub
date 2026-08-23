/* ═══ Floating components barrel exports ═══ */

import type { ComponentProps } from 'react';

import { ContextMenu } from './ContextMenu';
import { EmojiPicker } from './EmojiPicker';
import { ForwardConversationPicker } from './ForwardConversationPicker';
import { MultiSelectBar } from './MultiSelectBar';
import { PersonPanel } from './PersonPanel';
import { ProfilePopover } from './ProfilePopover';
import { SelectionDeleteConfirm } from './SelectionDeleteConfirm';
import { DemoToast } from './DemoToast';

export {
  ContextMenu,
  EmojiPicker,
  ForwardConversationPicker,
  MultiSelectBar,
  PersonPanel,
  ProfilePopover,
  SelectionDeleteConfirm,
  DemoToast,
};

export type { ContextMenuProps, ContextMenuItem } from './ContextMenu';
export type { EmojiPickerProps } from './EmojiPicker';
export type { ForwardConversationPickerProps } from './ForwardConversationPicker';
export type { MultiSelectBarProps, MultiSelectBarAction } from './MultiSelectBar';
export type { SelectionDeleteConfirmProps } from './SelectionDeleteConfirm';
export type { DemoToastProps } from './DemoToast';

// PersonPanel and ProfilePopover use inline prop types that are not exported.
// Derive them via ComponentProps for consumers that need them.
export type PersonPanelProps = ComponentProps<typeof PersonPanel>;
export type ProfilePopoverProps = ComponentProps<typeof ProfilePopover>;
