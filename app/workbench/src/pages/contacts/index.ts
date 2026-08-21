/* ═══ Contacts page subview barrel exports ═══ */

export { AddContactModal } from './AddContactModal';

export {
  MemberRow,
  FriendRequestCard,
  SearchUserCard,
  GroupRow,
  ServiceCardRow,
  QuickActionGrid,
} from './ContactRows';

export { ContactMain } from './ContactMainViews';
export type { ContactMainProps } from './ContactMainViews';

export {
  ContactListPage,
  ContactNewPane,
  ContactGroupsPane,
  ContactServicePane,
  ContactProfilePopover,
} from './ContactMainParts';

export { ContactNav } from './ContactNav';
export type { ContactNavProps } from './ContactNav';

export {
  capabilityColor,
  NavGlyph,
  NAV_ITEMS,
  MODAL_TABS,
} from './shared';
export type { NavItem, ModalTabItem } from './shared';

export type {
  FriendRequestRow,
  HubContactRow,
  HubSearchResultRow,
  ContactMember,
  ContactGroup,
  ServiceDesk,
  ContactsPane,
  ContactModalTab,
  ContactProfile,
  ContactsPageProps,
} from './types';
