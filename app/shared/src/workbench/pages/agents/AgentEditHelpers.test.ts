import { describe, expect, it } from 'vitest';
import {
  EDIT_ENGINE_OPTIONS,
  EDIT_MODEL_OPTIONS,
  EDIT_MODE_OPTIONS,
  EDIT_STATE_OPTIONS,
  TOOL_PERMISSION_LABELS,
  buildStatusNoticeClassName,
  defaultToolPermission,
  getEditFieldConfigs,
} from './AgentEditHelpers';

describe('AgentEditHelpers', () => {
  /* ── Option arrays ── */

  it('exports engine options as [value, label] pairs', () => {
    expect(EDIT_ENGINE_OPTIONS).toHaveLength(4);
    expect(EDIT_ENGINE_OPTIONS).toContainEqual(['Claude Code', 'Claude Code']);
    expect(EDIT_ENGINE_OPTIONS).toContainEqual(['Codex', 'Codex']);
  });

  it('exports model options as [value, label] pairs', () => {
    expect(EDIT_MODEL_OPTIONS).toHaveLength(4);
    expect(EDIT_MODEL_OPTIONS).toContainEqual(['glm-5.1', 'glm-5.1']);
    expect(EDIT_MODEL_OPTIONS).toContainEqual(['gpt-5-codex', 'gpt-5-codex']);
  });

  it('exports mode options as [value, label] pairs', () => {
    expect(EDIT_MODE_OPTIONS).toHaveLength(5);
    expect(EDIT_MODE_OPTIONS).toContainEqual(['Plan → Code', 'Plan → Code']);
    expect(EDIT_MODE_OPTIONS).toContainEqual(['Autonomous', 'Autonomous']);
  });

  it('exports state options for all AgentState values', () => {
    expect(EDIT_STATE_OPTIONS).toHaveLength(4);
    expect(EDIT_STATE_OPTIONS).toContainEqual(['running', '运行中']);
    expect(EDIT_STATE_OPTIONS).toContainEqual(['idle', '空闲']);
    expect(EDIT_STATE_OPTIONS).toContainEqual(['ready', '就绪']);
    expect(EDIT_STATE_OPTIONS).toContainEqual(['waiting', '等待中']);
  });

  it('exports tool permission labels in display order', () => {
    expect(TOOL_PERMISSION_LABELS).toEqual(['允许', '需确认', '禁止']);
  });

  /* ── getEditFieldConfigs ── */

  it('returns 9 edit field configs covering text and select fields', () => {
    const configs = getEditFieldConfigs();
    expect(configs).toHaveLength(9);

    const textFields = configs.filter((c) => c.type === 'text');
    const selectFields = configs.filter((c) => c.type === 'select');

    expect(textFields).toHaveLength(5);
    expect(selectFields).toHaveLength(4);

    // Verify specific keys
    const keys = configs.map((c) => c.key);
    expect(keys).toEqual([
      'name',
      'role',
      'engine',
      'model',
      'mode',
      'state',
      'approval',
      'targetPreference',
      'scope',
    ]);
  });

  it('attaches options only to select-typed fields', () => {
    for (const config of getEditFieldConfigs()) {
      if (config.type === 'select') {
        expect(config.options).toBeDefined();
        expect(config.options!.length).toBeGreaterThan(0);
      } else {
        expect(config.options).toBeUndefined();
      }
    }
  });

  /* ── defaultToolPermission ── */

  it('resolves tool permission with 需确认 fallback', () => {
    expect(defaultToolPermission({ shell: '允许' }, 'shell')).toBe('允许');
    expect(defaultToolPermission({ shell: '禁止' }, 'browser')).toBe('需确认');
    expect(defaultToolPermission({}, 'shell')).toBe('需确认');
  });

  /* ── buildStatusNoticeClassName ── */

  it('builds className with both statusNotice and statusNoticeDanger', () => {
    const styles = { statusNotice: 'sn', statusNoticeDanger: 'danger' };
    expect(buildStatusNoticeClassName(styles)).toEqual({
      className: 'sn danger',
    });
  });

  it('returns only statusNotice when danger is missing', () => {
    const styles = { statusNotice: 'sn' };
    expect(buildStatusNoticeClassName(styles)).toEqual({ className: 'sn' });
  });

  it('returns empty object when neither class exists', () => {
    expect(buildStatusNoticeClassName({})).toEqual({});
  });

  it('returns empty when statusNotice is absent but danger exists', () => {
    const styles = { statusNoticeDanger: 'danger' };
    expect(buildStatusNoticeClassName(styles)).toEqual({});
  });
});
