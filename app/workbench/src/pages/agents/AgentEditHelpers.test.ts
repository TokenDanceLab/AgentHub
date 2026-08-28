import { beforeAll, describe, expect, it } from 'vitest';
import { getI18n } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import {
  EDIT_ENGINE_OPTIONS,
  EDIT_MODEL_OPTIONS,
  EDIT_MODE_OPTIONS,
  TOOL_PERMISSION_LABELS,
  buildStatusNoticeClassName,
  defaultToolPermission,
  getEditFieldConfigs,
  getEditStateOptions,
} from './AgentEditHelpers';
import type { EditHelpersTranslator } from './AgentEditHelpers';

/** Translator bound to the shared test i18next instance (#1717). */
function translator(): EditHelpersTranslator {
  const i18n = getI18n();
  if (!i18n) throw new Error('test i18n instance missing');
  return i18n.getFixedT(null, SHARED_WORKBENCH_I18N_NAMESPACE);
}

describe('AgentEditHelpers', () => {
  beforeAll(async () => {
    await useTestI18nLanguage('zh');
  });

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

  it('builds state options for all AgentState values with translated labels', () => {
    const options = getEditStateOptions(translator());
    expect(options).toHaveLength(4);
    expect(options).toContainEqual(['running', '运行中']);
    expect(options).toContainEqual(['idle', '空闲']);
    expect(options).toContainEqual(['ready', '就绪']);
    expect(options).toContainEqual(['waiting', '等待中']);
  });

  it('exports tool permission labels in display order (data-plane enum identifiers)', () => {
    expect(TOOL_PERMISSION_LABELS).toEqual(['允许', '需确认', '禁止']);
  });

  /* ── getEditFieldConfigs ── */

  it('returns 9 edit field configs covering text and select fields', () => {
    const configs = getEditFieldConfigs(translator());
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
    for (const config of getEditFieldConfigs(translator())) {
      if (config.type === 'select') {
        expect(config.options).toBeDefined();
        expect(config.options!.length).toBeGreaterThan(0);
      } else {
        expect(config.options).toBeUndefined();
      }
    }
  });

  it('resolves field labels through the sharedWorkbench bundle', () => {
    const configs = getEditFieldConfigs(translator());
    const labelByKey = Object.fromEntries(configs.map((c) => [c.key, c.label]));
    expect(labelByKey.name).toBe('名称');
    expect(labelByKey.role).toBe('职责');
    expect(labelByKey.engine).toBe('运行引擎');
    expect(labelByKey.model).toBe('默认模型');
    expect(labelByKey.mode).toBe('运行模式');
    expect(labelByKey.state).toBe('状态');
    expect(labelByKey.approval).toBe('审批策略');
    expect(labelByKey.targetPreference).toBe('目标偏好');
    expect(labelByKey.scope).toBe('上下文范围');
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
    expect(buildStatusNoticeClassName({ statusNoticeDanger: 'danger' })).toEqual({});
  });
});

describe('AgentEditHelpers en locale (#2015)', () => {
  beforeAll(async () => {
    await useTestI18nLanguage('en');
  });

  it('renders state option labels and field labels in English', () => {
    const t = translator();
    expect(getEditStateOptions(t)).toContainEqual(['running', 'Running']);
    expect(getEditStateOptions(t)).toContainEqual(['waiting', 'Waiting']);
    const labelByKey = Object.fromEntries(getEditFieldConfigs(t).map((c) => [c.key, c.label]));
    expect(labelByKey.name).toBe('Name');
    expect(labelByKey.engine).toBe('Runtime');
    expect(labelByKey.state).toBe('Status');
    expect(labelByKey.scope).toBe('Context scope');
  });
});
