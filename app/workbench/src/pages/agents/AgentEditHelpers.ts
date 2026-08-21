import type { ToolPermission } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   AgentEditHelpers — pure residual slices from AgentEditPanel (#695).

   Edit field configs, option arrays, label constants, and className
   builders only. No React / no intentional UX change.
   exactOptionalPropertyTypes-safe.
   ═══════════════════════════════════════════════════════════════════════ */

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

export const EDIT_STATE_OPTIONS: [string, string][] = [
  ['running', '运行中'],
  ['ready', '就绪'],
  ['idle', '空闲'],
  ['waiting', '等待中'],
];

export const TOOL_PERMISSION_LABELS: ToolPermission[] = ['允许', '需确认', '禁止'];

/* ── Edit field configs ── */

export interface EditFieldConfig {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: [string, string][] | undefined;
}

const EDIT_FIELD_CONFIGS: EditFieldConfig[] = [
  { key: 'name', label: '名称', type: 'text' },
  { key: 'role', label: '职责', type: 'text' },
  { key: 'engine', label: '运行引擎', type: 'select', options: EDIT_ENGINE_OPTIONS },
  { key: 'model', label: '默认模型', type: 'select', options: EDIT_MODEL_OPTIONS },
  { key: 'mode', label: '运行模式', type: 'select', options: EDIT_MODE_OPTIONS },
  { key: 'state', label: '状态', type: 'select', options: EDIT_STATE_OPTIONS },
  { key: 'approval', label: '审批策略', type: 'text' },
  { key: 'targetPreference', label: '目标偏好', type: 'text' },
  { key: 'scope', label: '上下文范围', type: 'text' },
];

/** Returns the edit field configs for the AgentEditGrid. */
export function getEditFieldConfigs(): EditFieldConfig[] {
  return EDIT_FIELD_CONFIGS;
}

/* ── Tool permission default ── */

/** Default tool permission value used inline in the permission segment. */
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
