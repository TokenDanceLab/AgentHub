import type { TFunction } from 'i18next';
import type { ToolPermission } from './types';

/* ═══════════════════════════════════════════════════════════════════════════════════════
   AgentEditHelpers — pure residual slices from AgentEditPanel (#695).

   Edit field configs, option arrays, label constants, and className
   builders only. No React / no intentional UX change.
   exactOptionalPropertyTypes-safe.

   i18n note (#2015): display copy resolves through the sharedWorkbench
   bundle via a passed-in translator; data-plane ToolPermission enum
   identifiers stay verbatim (see TOOL_PERMISSION_LABELS /
   defaultToolPermission below).
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Translator signature for pure helpers receiving the component's `t`.
 * Uses i18next's TFunction directly: a structural `(key, options?)` shape
 * is not assignable from TFunction under exactOptionalPropertyTypes
 * (desktop tsconfig), which broke frontend-desktop CI. #2012
 */
export type EditHelpersTranslator = TFunction<'sharedWorkbench'>;

/* ── Select option arrays ── */

export const EDIT_ENGINE_OPTIONS: [string, string][] = ['Claude Code', 'DeepSeek', 'Codex', 'Browser Worker'].map(
  (opt) => [opt, opt],
);

export const EDIT_MODEL_OPTIONS: [string, string][] = ['DeepSeek-V4-Pro', 'kimi-k2.6', 'glm-5.1', 'gpt-5-codex'].map(
  (opt) => [opt, opt],
);

export const EDIT_MODE_OPTIONS: [string, string][] = ['Plan → Code', 'Review', 'Research', 'Deploy', 'Autonomous'].map(
  (opt) => [opt, opt],
);

/** State select options: AgentState value keys + translated display labels. */
export function getEditStateOptions(t: EditHelpersTranslator): [string, string][] {
  return [
    ['running', t('agents.edit.stateOptions.running')],
    ['ready', t('agents.edit.stateOptions.ready')],
    ['idle', t('agents.edit.stateOptions.idle')],
    ['waiting', t('agents.edit.stateOptions.waiting')],
  ];
}

/**
 * ToolPermission enum values rendered directly as segment options.
 * These Chinese strings are the data-plane identifiers defined in ./types
 * (ToolPermission union); display localization belongs to the cross-surface
 * enum decision tracked in #2015, not a copy change here.
 */
export const TOOL_PERMISSION_LABELS: ToolPermission[] = ['允许', '需确认', '禁止'];

/* ── Edit field configs ── */

export interface EditFieldConfig {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: [string, string][] | undefined;
}

/** Builds the edit field configs for the AgentEditGrid with translated labels. */
export function getEditFieldConfigs(t: EditHelpersTranslator): EditFieldConfig[] {
  return [
    { key: 'name', label: t('agents.edit.fields.name'), type: 'text' },
    { key: 'role', label: t('agents.edit.fields.role'), type: 'text' },
    { key: 'engine', label: t('agents.detail.runtime'), type: 'select', options: EDIT_ENGINE_OPTIONS },
    { key: 'model', label: t('agents.detail.model'), type: 'select', options: EDIT_MODEL_OPTIONS },
    { key: 'mode', label: t('agents.detail.mode'), type: 'select', options: EDIT_MODE_OPTIONS },
    { key: 'state', label: t('agents.detail.status'), type: 'select', options: getEditStateOptions(t) },
    { key: 'approval', label: t('agents.detail.approvalPolicy'), type: 'text' },
    { key: 'targetPreference', label: t('agents.edit.fields.targetPreference'), type: 'text' },
    { key: 'scope', label: t('agents.edit.fields.scope'), type: 'text' },
  ];
}

/* ── Tool permission default ── */

/**
 * Default tool permission value used inline in the permission segment.
 * Returns the ToolPermission enum identifier (data plane), not UI copy.
 */
export function defaultToolPermission(tools: Record<string, ToolPermission>, tool: string): ToolPermission {
  return tools[tool] || '需确认';
}

/* ── StatusNotice className builder ── */

/**
 * Build a safe className prop for StatusNotice without undefined spreads.
 * Returns `{ className }` only when styles.statusNotice exists,
 * appending statusNoticeDanger when both are present.
 */
export function buildStatusNoticeClassName(
  moduleStyles: Record<string, string>,
): { className?: string } {
  const a = moduleStyles.statusNotice;
  const b = moduleStyles.statusNoticeDanger;
  if (a && b) return { className: `${a} ${b}` };
  if (a) return { className: a };
  return {};
}
