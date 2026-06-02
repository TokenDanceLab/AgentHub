export type TopMenuId = 'file' | 'edit' | 'view' | 'window' | 'help';

export function resolveTopMenuClickState(
  current: TopMenuId | null,
  clicked: TopMenuId,
  hoverOpened: TopMenuId | null,
): TopMenuId | null {
  if (current === clicked && hoverOpened !== clicked) return null;
  return clicked;
}
