/* ═══════════════════════════════════════════════════════════════════════
   Settings pane content renderers — extracted for Phase 18 #572.
   Residual thin: helpers + parts (#686).
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import {
  DataModeControl,
  SettingPath,
  SettingSegment,
  SettingSwitch,
  SettingValue,
  SettingsRow,
  SettingsSection,
} from './shared';
import {
  AgentConfigLink,
  DataModeStatus,
  LocalCliDiscoveryStatus,
  StatePreviewSection,
} from './SettingsPaneParts';
import { SessionImportList } from '../../sessionImport';
import { ThemePresetPicker } from './ThemePresetPicker';
import { writeClipboardText } from '../../workbenchTranscriptChromeStateHelpers';
import { resolvePermissionValue } from './SettingsPaneHelpers';
import { PERMISSION_ROWS } from './types';
import type { SettingsPageProps, SettingsPaneId } from './types';
import {
  checkConflicts,
  deriveKeysFromEvent,
  getCustomKeybindings,
  getResolvedShortcutGroups,
  hasCustomKeybindings,
  resetKeybindings,
  saveCustomKeybindings,
} from '@shared/utils/keyboardShortcuts';
import type { KeyboardShortcutGroup } from '@shared/utils/keyboardShortcuts';
import styles from './SettingsPanes.module.css';

export {
  DataModeStatus,
  LocalCliDiscoveryStatus,
  StatePanel,
  StatePreviewSection,
  AgentConfigLink,
} from './SettingsPaneParts';

/* ═══════════════════════════════════════════════════════════════════════
   Pane content renderers
   ═══════════════════════════════════════════════════════════════════════ */

export function AppearancePane(props: SettingsPageProps): React.ReactElement {
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <>
      <SettingsSection title={tw("settings.section.interface")}>
        <SettingsRow label="主题" description="默认浅色；左下角主题按钮只负责快速切换当前预览。">
          <SettingSegment options={['跟随系统', '浅色', '深色']} active={props.theme} onChange={(v) => props.onChangeSetting('theme', v)} />
        </SettingsRow>
        {/* #1986 (UX F15): preset switcher lives in workbench settings; the
            shared SSOT applies/persists/notifies so both surfaces stay in sync. */}
        <SettingsRow wide label={tw("settings.themePreset.label")} description={tw("settings.themePreset.description")}>
          <ThemePresetPicker groupLabel={tw("settings.themePreset.aria")} defaultLabel={tw("settings.themePreset.default")} />
        </SettingsRow>
        {/* Density / run-step default / animation intensity are persisted but
            not consumed anywhere yet — disabled until they take effect (#1818). */}
        <SettingsRow comingSoon label="消息密度" description="聊天列表、气泡和 Agent 运行块保持紧凑但可扫描。">
          <SettingSegment disabled options={['紧凑', '标准', '宽松']} active={props.density} onChange={(v) => props.onChangeSetting('density', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="运行步骤默认状态" description="工具调用、文件编辑和深度思考默认折叠，只显示摘要。">
          <SettingSegment disabled options={['折叠', '展开']} active={props.runStepDefault} onChange={(v) => props.onChangeSetting('runStepDefault', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="动画强度" description="折叠展开使用 150-200ms 的透明度和位移动画。">
          <SettingSegment disabled options={['减少', '标准']} active={props.animationIntensity} onChange={(v) => props.onChangeSetting('animationIntensity', v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={tw("settings.section.layout")}>
        <SettingsRow label="右侧概览" description="新聊天默认显示，用户可从聊天头部收起。">
          <SettingSwitch active={props.inspectorVisible} onChange={(v) => props.onChangeSetting('inspectorVisible', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="连续 Agent 头像" description="连续发送时只显示第一条头像，后续消息按气泡列对齐。">
          <SettingSwitch disabled active={props.stackedAvatars} onChange={(v) => props.onChangeSetting('stackedAvatars', v)} />
        </SettingsRow>
        <SettingsRow label="Composer 宽度" description="随右侧概览折叠状态自适应，不使用固定硬编码宽度。">
          <SettingValue value="自适应" />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

export function NotifyPane(props: SettingsPageProps): React.ReactElement {
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <>
      {/* Notification routing is not wired to a real notification center
          yet; every control here stays disabled + coming soon (#1818). */}
      <SettingsSection title={tw("settings.section.runNotifications")}>
        <SettingsRow comingSoon label="任务完成" description="Builder、Reviewer、Deployer 完成后在当前会话内提示。">
          <SettingSwitch disabled active={props.taskCompleteNotify} onChange={(v) => props.onChangeSetting('taskCompleteNotify', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="审批请求" description="写文件、部署、外部调用等中高风险操作强提醒。">
          <SettingSegment disabled options={['静默', '横幅', '强提醒']} active={props.approvalNotifyLevel} onChange={(v) => props.onChangeSetting('approvalNotifyLevel', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="失败和阻塞" description="失败、超时、权限不足统一进入通知中心。">
          <SettingSwitch disabled active={props.failureNotify} onChange={(v) => props.onChangeSetting('failureNotify', v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={tw("settings.section.collaborationNotifications")}>
        <SettingsRow comingSoon label="项目群消息" description="项目成员提及、公告更新和产物变更。">
          <SettingSegment disabled options={['全部', '提及', '关闭']} active={props.projectGroupNotifyLevel} onChange={(v) => props.onChangeSetting('projectGroupNotifyLevel', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="云文档更新" description="评论、权限请求、归档状态和分享失效。">
          <SettingSegment disabled options={['全部', '重要', '关闭']} active={props.docUpdateNotifyLevel} onChange={(v) => props.onChangeSetting('docUpdateNotifyLevel', v)} />
        </SettingsRow>
        <SettingsRow label="免打扰" description="保留紧急审批，其余提醒压到侧栏角标。">
          <SettingValue value={props.dndWindow} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

export function AgentDefaultsPane(props: SettingsPageProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <>
      <SettingsSection title={tw("settings.section.defaultRunConfig")}>
        <SettingsRow label="默认模型" description="新 Agent 会话默认使用的模型徽标。">
          <SettingValue value={props.defaultModel} />
        </SettingsRow>
        <SettingsRow label="默认执行器" description="Builder 会话显示 Claude Code，其他 Agent 可单独覆盖。">
          <SettingValue value={props.defaultExecutor} />
        </SettingsRow>
        <SettingsRow comingSoon label="工具调用展示" description="Read、rg、Shell、Write、Browser 等工具以统一步骤块渲染。">
          <SettingSegment disabled options={['摘要', '详情']} active={props.toolCallDisplay} onChange={(v) => props.onChangeSetting('toolCallDisplay', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="深度思考" description="运行中展示摘要，展开后显示完整推理块。">
          <SettingSegment disabled options={['隐藏', '摘要', '完整']} active={props.deepThinkingDisplay} onChange={(v) => props.onChangeSetting('deepThinkingDisplay', v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={tw("settings.section.permissionPolicy")}>
        {PERMISSION_ROWS.map(([tool, value, desc]) => (
          <SettingsRow comingSoon key={tool} label={tool} description={desc} wide>
            <SettingSegment
              disabled
              options={['允许', '需确认', '禁止']}
              active={resolvePermissionValue(props.permissions, tool, value)}
              onChange={(v) => props.onChangeSetting(`perm_${tool}`, v)}
            />
          </SettingsRow>
        ))}
      </SettingsSection>

      {props.onOpenAgentConfig ? (
        <AgentConfigLink
          ariaLabel={t('aria.agentConfig')}
          title={tw("settings.section.singleAgentConfig")}
          description="为每个 Agent 单独配置运行器 (CC/Codex/OpenCode/SDK)、模型、System Prompt 和 MCP 绑定。"
          actionLabel="打开 Agent 配置"
          onOpen={props.onOpenAgentConfig}
        />
      ) : null}
    </>
  );
}

export function LocalDevPane(props: SettingsPageProps): React.ReactElement {
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <>
      <SettingsSection title={tw("settings.section.localPreview")}>
        {/* Copy buttons write the value to the clipboard — a real effect (#1818). */}
        <SettingsRow label="Vite 地址" description="用于实时预览 AgentHub Desktop design demo。">
          <SettingPath value={props.vitePreviewUrl} onCopy={() => writeClipboardText(props.vitePreviewUrl)} />
        </SettingsRow>
        <SettingsRow label="工作区" description="当前设计 demo 仓库路径。">
          <SettingPath value={props.workspacePath} onCopy={() => writeClipboardText(props.workspacePath)} />
        </SettingsRow>
        <SettingsRow label="目标项目" description="后续迁移到真实 AgentHub Desktop 的参考项目。">
          <SettingPath value={props.targetProjectPath} onCopy={() => writeClipboardText(props.targetProjectPath)} />
        </SettingsRow>
        <SettingsRow comingSoon label="热更新覆盖层" description="保留 Vite 错误 overlay，开发时能直接看到语法问题。">
          <SettingSwitch disabled active={props.hrmOverlayEnabled} onChange={(v) => props.onChangeSetting('hrmOverlayEnabled', v)} />
        </SettingsRow>
        <SettingsRow label="数据模式" description="Auto 可开发回退；Mock/Fixture 固定本地数据；Observed/Approved real 不回退。">
          <DataModeControl active={props.dataMode} onChange={(v) => props.onChangeSetting('dataMode', v)} />
        </SettingsRow>
        <SettingsRow label="发送快捷键" description="默认 Enter 发送；需要换行时使用 Ctrl / Cmd + Enter。">
          <SettingSegment options={['Enter 发送', 'Ctrl+Enter 发送']} active={props.composerSubmitBehavior} onChange={(v) => props.onChangeSetting('composerSubmitBehavior', v)} />
        </SettingsRow>
      </SettingsSection>

      <DataModeStatus mode={props.dataMode} />

      <SettingsSection title={tw("settings.section.debug")}>
        <SettingsRow label="视觉 QA" description="需要时用浏览器截图检查桌面和窄宽布局。">
          <SettingValue value={props.visualQaMode} />
        </SettingsRow>
        <SettingsRow comingSoon label="日志级别" description="仅 demo 前端事件和交互状态。">
          <SettingSegment disabled options={['错误', '标准', '详细']} active={props.logLevel} onChange={(v) => props.onChangeSetting('logLevel', v)} />
        </SettingsRow>
        <SettingsRow label="设计系统校验" description="重大 UI 改动后再跑设计治理脚本，日常迭代保持轻量。">
          <SettingValue value={props.designSystemValidation} />
        </SettingsRow>
      </SettingsSection>

      {props.sessionImportVisible ? (
        <SettingsSection title={tw("settings.section.localSessionImport")}>
          <SettingsRow
            label="运行时会话"
            description="只读导入本机 Agent Runtime 会话摘要（导入/观察模式，不修改外部存储）。"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {props.onRefreshSessionImport ? (
                <button type="button" onClick={props.onRefreshSessionImport}>
                  {props.sessionImportLoading ? '刷新中…' : '刷新列表'}
                </button>
              ) : null}
              {props.sessionImportError ? (
                <div role="alert">{props.sessionImportError}</div>
              ) : null}
              <SessionImportList
                items={props.sessionImportItems ?? []}
                emptyLabel={
                  props.sessionImportLoading
                    ? '正在加载本地会话…'
                    : '暂无本地可导入会话'
                }
              />
            </div>
          </SettingsRow>
        </SettingsSection>
      ) : null}

      {props.localCliDiscovery ? <LocalCliDiscoveryStatus discovery={props.localCliDiscovery} /> : null}
    </>
  );
}

export function StatesPane(props: SettingsPageProps): React.ReactElement {
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <>
      <SettingsSection title={tw("settings.section.statePolicy")}>
        {/* Strategy flags are persisted but not consumed yet — disabled with
            a coming-soon note until they gate real rendering (#1818). */}
        <SettingsRow comingSoon label="空状态" description="说明当前为空，并提供一个明确下一步。">
          <SettingSwitch disabled active={props.stateStrategies.empty} onChange={(v) => props.onChangeSetting('stateStrategy_empty', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="无效状态" description="链接失效、权限不足和数据过期使用 warning 语义。">
          <SettingSwitch disabled active={props.stateStrategies.invalid} onChange={(v) => props.onChangeSetting('stateStrategy_invalid', v)} />
        </SettingsRow>
        <SettingsRow comingSoon label="404 状态" description="项目归档、页面移动或不存在时给出返回路径。">
          <SettingSwitch disabled active={props.stateStrategies.missing} onChange={(v) => props.onChangeSetting('stateStrategy_missing', v)} />
        </SettingsRow>
      </SettingsSection>

      <StatePreviewSection />
    </>
  );
}

/* ── Keyboard shortcuts pane ── */

function formatKeys(keys: string[]): string {
  return keys.join(' + ');
}

/**
 * Label key of the shortcut that collides with `shortcutId` in this group.
 * #2154 P3-6: returns the labelKey (not the raw shortcut id) so the conflict
 * copy can name the other binding the way the rest of the pane does — the id
 * ('send', 'toggle-sidebar') is an internal identifier and means nothing to
 * the user.
 */
function shortcutConflictLabelKey(group: KeyboardShortcutGroup, shortcutId: string): string | null {
  const shortcut = group.shortcuts.find((s) => s.id === shortcutId);
  if (!shortcut) return null;
  const conflict = checkConflicts(shortcut.keys, shortcutId);
  return conflict ? conflict.labelKey : null;
}

export function ShortcutsPane(_props: SettingsPageProps): React.ReactElement {
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  // shortcut.* keys live in the chatview bundle — translate labels with the
  // owning namespace instead of rendering raw keys (#1853 review).
  const { t: tc } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  // #1822: previously read-only and dead — saveCustomKeybindings /
  // resetKeybindings had no UI callers. Rows now record a key combo on
  // click (capture listener) and persist via saveCustomKeybindings; the
  // dispatcher reads resolved groups, so remaps take effect immediately.
  const [groups, setGroups] = useState<KeyboardShortcutGroup[]>(getResolvedShortcutGroups);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  // #1853 review: keep BOTH sides — the shortcut being recorded (whose row
  // shows the rejection) and the label of the shortcut it collided with
  // (message context). #2154 P3-6: the colliding side is stored as a labelKey
  // so the copy renders a localized name instead of an internal id.
  const [conflictState, setConflictState] = useState<{ recordedId: string; conflictingLabelKey: string } | null>(null);
  const hasCustom = useMemo(() => hasCustomKeybindings(), [groups]);

  useEffect(() => {
    const targetId = recordingId;
    if (!targetId) return;
    function handleRecord(event: KeyboardEvent): void {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecordingId(null);
        return;
      }
      const keys = deriveKeysFromEvent(event);
      if (keys.length === 0) return;
      // Guarded above (`if (!targetId) return`) — assert to keep the closure's
      // captured narrow (task TS version does not retain it in nested function
      // declarations).
      const capturedId = targetId as string;
      // Block a remap that collides with another (resolved) binding — the
      // conflict badge would otherwise show two rows sharing one combo.
      const conflict = checkConflicts(keys, capturedId);
      if (conflict) {
        setConflictState({ recordedId: capturedId, conflictingLabelKey: conflict.labelKey });
        setRecordingId(null);
        return;
      }
      setConflictState(null);
      // #1853 review: MERGE with existing custom bindings — a whole-map
      // replace silently dropped every previously remapped shortcut.
      saveCustomKeybindings([
        ...getCustomKeybindings().filter((binding) => binding.id !== capturedId),
        { id: capturedId, keys },
      ]);
      setRecordingId(null);
      setGroups(getResolvedShortcutGroups());
    }
    document.addEventListener('keydown', handleRecord, true);
    return () => document.removeEventListener('keydown', handleRecord, true);
  }, [recordingId]);

  // #2154 P3-6: one shared, localized conflict sentence for both paths — the
  // rejected recording and the (defensive) already-conflicting row. Recording
  // refuses collisions before saving, so the second path only fires for
  // bindings stored before that guard existed.
  const conflictCopy = (labelKey: string): string => tw('settings.shortcuts.conflict', {
    defaultValue: '该组合与「{{name}}」冲突，未保存',
    name: tc(labelKey),
  });

  return (
    <>
      <SettingsRow
        label={tw('settings.shortcuts.customize', { defaultValue: '自定义快捷键' })}
        description={tw('settings.shortcuts.customizeDetail', { defaultValue: '点击按键组合即可录制新的绑定；所有绑定立即生效。' })}
      >
        <button
          type="button"
          className={styles.resetButton}
          onClick={() => {
            resetKeybindings();
            setConflictState(null);
            setGroups(getResolvedShortcutGroups());
          }}
          disabled={!hasCustom && !recordingId}
        >
          {tw('settings.shortcuts.reset', { defaultValue: '重置为默认' })}
        </button>
      </SettingsRow>
      {groups.map((group) => (
        <SettingsSection key={group.id} title={tc(group.labelKey)}>
          {group.shortcuts.map((shortcut) => {
            const conflictLabelKeyNow = shortcutConflictLabelKey(group, shortcut.id);
            const hasConflict = conflictLabelKeyNow !== null;
            // #1853 review: the rejection belongs to the RECORDED shortcut —
            // not to the colliding one and not to every row.
            const recordedConflict = conflictState?.recordedId === shortcut.id;
            return (
              <SettingsRow
                key={shortcut.id}
                label={tc(shortcut.labelKey)}
                description={
                  shortcut.rebindable === false
                    ? (shortcut.detailKey ? tc(shortcut.detailKey) : '')
                    : recordingId === shortcut.id
                      ? tw('settings.shortcuts.recording', { defaultValue: '按下新的按键组合…（Esc 取消）' })
                      : recordedConflict
                        ? conflictCopy(conflictState.conflictingLabelKey)
                        : conflictLabelKeyNow !== null
                          ? conflictCopy(conflictLabelKeyNow)
                          : (shortcut.detailKey ? tc(shortcut.detailKey) : '')
                }
              >
                {shortcut.rebindable === false ? (
                  // #1823: selection-mode hotkeys are declarative only —
                  // resolveSelectionHotkey owns their fixed bindings, so the
                  // pane renders them without a recorder.
                  <span className={styles.fixedKey}>{formatKeys(shortcut.keys)}</span>
                ) : (
                  <button
                    type="button"
                    aria-label={tw('settings.shortcuts.remap', { defaultValue: '重新绑定' })}
                    className={hasConflict || recordedConflict ? styles.keyButtonDanger : styles.keyButton}
                    onClick={() => {
                      setConflictState(null);
                      setRecordingId((current) => current === shortcut.id ? null : shortcut.id);
                    }}
                  >
                    {recordingId === shortcut.id
                      ? tw('settings.shortcuts.recording', { defaultValue: '按下…' })
                      : formatKeys(shortcut.keys)}
                  </button>
                )}
              </SettingsRow>
            );
          })}
        </SettingsSection>
      ))}
    </>
  );
}

export const PANE_RENDERERS: Record<SettingsPaneId, React.FC<SettingsPageProps>> = {
  appearance: AppearancePane,
  notify: NotifyPane,
  agent: AgentDefaultsPane,
  local: LocalDevPane,
  shortcuts: ShortcutsPane,
  states: StatesPane,
};
