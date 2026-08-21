import type { DesignNavIconName } from '../../designIcons';
import { getWorkbenchDataModeContract } from '@shared/demo';
import type { LocalCliDiscoveryItem } from '@shared/platform';
import type { StatePanelKind } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   SettingsPaneHelpers — pure residual slices from SettingsPanes (#686).

   Data-mode labels, CLI discovery meta lines, state-panel icon/class
   packing, and state preview specs. No React / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

/** Status-head label for the data-mode contract panel. */
export function dataModeStatusLabel(mode: string): string {
  const detail = getWorkbenchDataModeContract(mode);
  if (detail.mode === 'auto') return 'Auto fallback';
  if (detail.mode === 'approved-real') return 'Approved real';
  return `${detail.displayLabel} data`;
}

/** Shared contract fields used by DataModeStatus. */
export function dataModeStatusDetail(mode: string) {
  return getWorkbenchDataModeContract(mode);
}

/** CLI discovery row description: version · path. */
export function formatLocalCliItemDescription(item: Pick<LocalCliDiscoveryItem, 'version' | 'path'>): string {
  const version = item.version ? `version ${item.version}` : 'version unknown';
  return `${version} · ${item.path}`;
}

/** CLI discovery row value: installed/missing · no-spend/requires approval. */
export function formatLocalCliItemValue(
  item: Pick<LocalCliDiscoveryItem, 'installed' | 'noSpend'>,
): string {
  return `${item.installed ? 'installed' : 'missing'} · ${item.noSpend ? 'no-spend' : 'requires approval'}`;
}

/** DesignNavIcon name for a state-panel kind. */
export function statePanelIconName(kind: StatePanelKind): DesignNavIconName {
  if (kind === 'missing') return 'error404';
  if (kind === 'invalid') return 'lock';
  return 'inbox';
}

export type StatePanelKindClassMap = {
  statePanelEmpty?: string | undefined;
  statePanelInvalid?: string | undefined;
  statePanelMissing?: string | undefined;
};

/**
 * Resolve the kind-specific surface class without spreading undefined
 * (exactOptionalPropertyTypes-safe consumers can join with a base class).
 */
export function statePanelKindClassName(
  kind: StatePanelKind,
  css: StatePanelKindClassMap,
): string {
  if (kind === 'empty') return css.statePanelEmpty ?? '';
  if (kind === 'invalid') return css.statePanelInvalid ?? '';
  return css.statePanelMissing ?? '';
}

/** Join base + optional kind class without trailing/double spaces. */
export function joinClassNames(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' ');
}

export type StatePreviewSpec = {
  kind: StatePanelKind;
  label: string;
  title: string;
  copy: string;
  actionLabel: string;
  /** onChangeSetting key used by the preview action button. */
  actionKey: string;
};

/** Design-system state component preview cards (States pane). */
export const STATE_PREVIEW_SPECS: readonly StatePreviewSpec[] = [
  {
    kind: 'empty',
    label: '空列表',
    title: '还没有云文档',
    copy: '创建第一份文档或从本地上传文件。',
    actionLabel: '新建文档',
    actionKey: 'action_state_empty',
  },
  {
    kind: 'invalid',
    label: '无效状态',
    title: '链接已失效',
    copy: '该分享链接过期，或你没有访问权限。',
    actionLabel: '请求权限',
    actionKey: 'action_state_invalid',
  },
  {
    kind: 'missing',
    label: '404',
    title: '页面不存在',
    copy: '该项目页可能已归档、删除或移动。',
    actionLabel: '返回项目',
    actionKey: 'action_state_missing',
  },
];

/** Active permission value: props override, else row default. */
export function resolvePermissionValue(
  permissions: Record<string, string>,
  tool: string,
  fallback: string,
): string {
  return permissions[tool] ?? fallback;
}
