import React from 'react';
import { DesignNavIcon, type DesignNavIconName } from '../designIcons';
import styles from './SettingsPage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   SettingsPage — AgentHub v4
   Left nav (sections + scope) + right main (settings rows + state preview)
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public props ── */

export interface SettingsPageProps {
  /** Currently active settings pane id. */
  activePane: SettingsPaneId;
  /** Human-friendly label for the current space. */
  spaceTitle: string;
  /** Meta description for the current space. */
  spaceMeta: string;
  /** Theme value for the appearance segment. */
  theme: string;
  /** Density value for the appearance segment. */
  density: string;
  /** Default run-step state for Agent blocks. */
  runStepDefault: string;
  /** Animation intensity. */
  animationIntensity: string;
  /** Right inspector default visibility. */
  inspectorVisible: boolean;
  /** Stacked Agent avatar mode. */
  stackedAvatars: boolean;
  /** Task-complete notification enabled. */
  taskCompleteNotify: boolean;
  /** Approval notification level. */
  approvalNotifyLevel: string;
  /** Failure notification enabled. */
  failureNotify: boolean;
  /** Project group message notify level. */
  projectGroupNotifyLevel: string;
  /** Cloud doc update notify level. */
  docUpdateNotifyLevel: string;
  /** Do-not-disturb window label. */
  dndWindow: string;
  /** Default model label. */
  defaultModel: string;
  /** Default executor label. */
  defaultExecutor: string;
  /** Tool call display level. */
  toolCallDisplay: string;
  /** Deep-thinking display level. */
  deepThinkingDisplay: string;
  /** Permission values keyed by tool name. */
  permissions: Record<string, string>;
  /** Local Vite preview URL. */
  vitePreviewUrl: string;
  /** Local workspace path. */
  workspacePath: string;
  /** Target project path. */
  targetProjectPath: string;
  /** Hot-reload overlay enabled. */
  hrmOverlayEnabled: boolean;
  /** Visual QA mode label. */
  visualQaMode: string;
  /** Log level. */
  logLevel: string;
  /** Design-system validation mode. */
  designSystemValidation: string;
  /** State strategy toggles. */
  stateStrategies: Record<'empty' | 'invalid' | 'missing', boolean>;
  /** Called when the user selects a different pane. */
  onSelectPane: (pane: SettingsPaneId) => void;
  /** Called when any setting value changes. */
  onChangeSetting: (key: string, value: string | boolean) => void;
}

export type SettingsPaneId = 'appearance' | 'notify' | 'agent' | 'local' | 'states';

/* ── Nav config ── */

interface NavItem {
  id: SettingsPaneId;
  label: string;
  glyph: DesignNavIconName;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'appearance', label: '外观', glyph: 'palette' },
  { id: 'notify', label: '通知', glyph: 'bell' },
  { id: 'agent', label: 'Agent 默认值', glyph: 'agent' },
  { id: 'local', label: '本地开发', glyph: 'laptop' },
  { id: 'states', label: '状态组件', glyph: 'states' },
];

/* ── Pane metadata ── */

interface PaneMeta {
  title: string;
  description: string;
}

const PANE_META: Record<SettingsPaneId, PaneMeta> = {
  appearance: {
    title: '外观',
    description: '统一控制应用主题、密度、动画和 Agent 运行块的默认呈现方式。',
  },
  notify: {
    title: '通知',
    description: '管理 Agent 运行、审批、项目群和云文档更新的提醒策略。',
  },
  agent: {
    title: 'Agent 默认值',
    description: '设置新会话默认模型、工具权限、审批策略和运行记录展示方式。',
  },
  local: {
    title: '本地开发',
    description: '配置本地 Vite 预览、工作目录、日志和设计 demo 调试开关。',
  },
  states: {
    title: '状态组件',
    description: '统一空状态、无效状态、404 和错误恢复样式，避免各页面自行发挥。',
  },
};

/* ── Design icons ── */

function NavGlyph({ name }: { name: DesignNavIconName }): React.ReactElement {
  return (
    <span className={styles.navGlyph} aria-hidden="true">
      <DesignNavIcon name={name} size={17} />
    </span>
  );
}

/** Permission row config: [tool, default-value, description]. */
const PERMISSION_ROWS: [string, string, string][] = [
  ['Read', '允许', '读取仓库文件和设计文档'],
  ['Write', '需确认', '写入源码、样式、配置'],
  ['Shell', '需确认', '运行本地命令和验证脚本'],
  ['Browser', '允许', '打开本地预览和截图验证'],
];

/* ═══════════════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Scope row ── */

interface SettingsScopeRowProps {
  title: string;
  meta: string;
}

function SettingsScopeRow({ title, meta }: SettingsScopeRowProps): React.ReactElement {
  return (
    <div className={styles.scopeRow} aria-label={title}>
      <strong>{title}</strong>
      <span>{meta}</span>
    </div>
  );
}

/* ── Settings section wrapper ── */

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingsSection({ title, children }: SettingsSectionProps): React.ReactElement {
  const count = React.Children.count(children);
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitleRow}>
        <h2>{title}</h2>
        <span>{count} items</span>
      </div>
      <div className={styles.list}>
        {children}
      </div>
    </section>
  );
}

/* ── Settings row ── */

interface SettingsRowProps {
  label: string;
  description: string;
  children: React.ReactNode;
  /** Use a wider control area (for permission segments). */
  wide?: boolean;
}

function SettingsRow({ label, description, children, wide = false }: SettingsRowProps): React.ReactElement {
  return (
    <div className={styles.row}>
      <div>
        <span className={styles.rowLabel}>{label}</span>
        <span className={styles.rowDesc}>{description}</span>
      </div>
      <div className={`${styles.control}${wide ? ` ${styles.controlWide}` : ''}`}>
        {children}
      </div>
    </div>
  );
}

/* ── Segmented control ── */

interface SettingSegmentProps {
  options: string[];
  active: string;
  onChange: (value: string) => void;
}

function SettingSegment({ options, active, onChange }: SettingSegmentProps): React.ReactElement {
  return (
    <div className={styles.segment}>
      {options.map((option) => (
        <button
          key={option}
          className={`${styles.segmentBtn}${option === active ? ` ${styles.segmentBtnActive}` : ''}`}
          type="button"
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/* ── Switch ── */

interface SettingSwitchProps {
  active: boolean;
  onChange: (active: boolean) => void;
}

function SettingSwitch({ active, onChange }: SettingSwitchProps): React.ReactElement {
  return (
    <button
      className={`${styles.switch}${active ? ` ${styles.switchOn}` : ''}`}
      type="button"
      role="switch"
      aria-checked={active}
      onClick={() => onChange(!active)}
    >
      <span className={styles.switchThumb} />
    </button>
  );
}

/* ── Value button ── */

interface SettingValueProps {
  value: string;
  onClick?: () => void;
}

function SettingValue({ value, onClick }: SettingValueProps): React.ReactElement {
  return (
    <button className={styles.value} type="button" onClick={onClick}>
      {value}
    </button>
  );
}

/* ── Path display ── */

interface SettingPathProps {
  value: string;
  onCopy?: () => void;
}

function SettingPath({ value, onCopy }: SettingPathProps): React.ReactElement {
  return (
    <div className={styles.path}>
      <code className={styles.pathCode}>{value}</code>
      <button
        className={styles.pathBtn}
        type="button"
        aria-label="复制路径"
        onClick={onCopy}
      >
        <DesignNavIcon name="copy" size={14} />
      </button>
    </div>
  );
}

/* ── State panel ── */

export type StatePanelKind = 'empty' | 'invalid' | 'missing';

interface StatePanelProps {
  kind: StatePanelKind;
  label: string;
  title: string;
  copy: string;
  actionLabel: string;
  onAction?: () => void;
}

function StatePanel({ kind, label, title, copy, actionLabel, onAction }: StatePanelProps): React.ReactElement {
  const kindClass =
    kind === 'empty' ? styles.statePanelEmpty :
    kind === 'invalid' ? styles.statePanelInvalid :
    styles.statePanelMissing;

  const stateIcon = (
    kind === 'missing' ? 'error404' :
    kind === 'invalid' ? 'lock' :
    'inbox'
  );

  return (
    <article className={`${styles.statePanel} ${kindClass}`} aria-label={label}>
      <div className={styles.stateMark} aria-hidden="true">
        <DesignNavIcon name={stateIcon} size={17} />
      </div>
      <h3>{title}</h3>
      <p>{copy}</p>
      <button type="button" onClick={onAction}>{actionLabel}</button>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Pane content renderers
   ═══════════════════════════════════════════════════════════════════════ */

function AppearancePane(props: SettingsPageProps): React.ReactElement {
  return (
    <>
      <SettingsSection title="界面">
        <SettingsRow label="主题" description="默认浅色；左下角主题按钮只负责快速切换当前预览。">
          <SettingSegment options={['跟随系统', '浅色', '深色']} active={props.theme} onChange={(v) => props.onChangeSetting('theme', v)} />
        </SettingsRow>
        <SettingsRow label="消息密度" description="聊天列表、气泡和 Agent 运行块保持紧凑但可扫描。">
          <SettingSegment options={['紧凑', '标准', '宽松']} active={props.density} onChange={(v) => props.onChangeSetting('density', v)} />
        </SettingsRow>
        <SettingsRow label="运行步骤默认状态" description="工具调用、文件编辑和深度思考默认折叠，只显示摘要。">
          <SettingSegment options={['折叠', '展开']} active={props.runStepDefault} onChange={(v) => props.onChangeSetting('runStepDefault', v)} />
        </SettingsRow>
        <SettingsRow label="动画强度" description="折叠展开使用 150-200ms 的透明度和位移动画。">
          <SettingSegment options={['减少', '标准']} active={props.animationIntensity} onChange={(v) => props.onChangeSetting('animationIntensity', v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="布局">
        <SettingsRow label="右侧概览" description="新聊天默认显示，用户可从聊天头部收起。">
          <SettingSwitch active={props.inspectorVisible} onChange={(v) => props.onChangeSetting('inspectorVisible', v)} />
        </SettingsRow>
        <SettingsRow label="连续 Agent 头像" description="连续发送时只显示第一条头像，后续消息按气泡列对齐。">
          <SettingSwitch active={props.stackedAvatars} onChange={(v) => props.onChangeSetting('stackedAvatars', v)} />
        </SettingsRow>
        <SettingsRow label="Composer 宽度" description="随右侧概览折叠状态自适应，不使用固定硬编码宽度。">
          <SettingValue value="自适应" />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function NotifyPane(props: SettingsPageProps): React.ReactElement {
  return (
    <>
      <SettingsSection title="运行提醒">
        <SettingsRow label="任务完成" description="Builder、Reviewer、Deployer 完成后在当前会话内提示。">
          <SettingSwitch active={props.taskCompleteNotify} onChange={(v) => props.onChangeSetting('taskCompleteNotify', v)} />
        </SettingsRow>
        <SettingsRow label="审批请求" description="写文件、部署、外部调用等中高风险操作强提醒。">
          <SettingSegment options={['静默', '横幅', '强提醒']} active={props.approvalNotifyLevel} onChange={(v) => props.onChangeSetting('approvalNotifyLevel', v)} />
        </SettingsRow>
        <SettingsRow label="失败和阻塞" description="失败、超时、权限不足统一进入通知中心。">
          <SettingSwitch active={props.failureNotify} onChange={(v) => props.onChangeSetting('failureNotify', v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="协作提醒">
        <SettingsRow label="项目群消息" description="项目成员提及、公告更新和产物变更。">
          <SettingSegment options={['全部', '提及', '关闭']} active={props.projectGroupNotifyLevel} onChange={(v) => props.onChangeSetting('projectGroupNotifyLevel', v)} />
        </SettingsRow>
        <SettingsRow label="云文档更新" description="评论、权限请求、归档状态和分享失效。">
          <SettingSegment options={['全部', '重要', '关闭']} active={props.docUpdateNotifyLevel} onChange={(v) => props.onChangeSetting('docUpdateNotifyLevel', v)} />
        </SettingsRow>
        <SettingsRow label="免打扰" description="保留紧急审批，其余提醒压到侧栏角标。">
          <SettingValue value={props.dndWindow} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function AgentDefaultsPane(props: SettingsPageProps): React.ReactElement {
  return (
    <>
      <SettingsSection title="默认运行配置">
        <SettingsRow label="默认模型" description="新 Agent 会话默认使用的模型徽标。">
          <SettingValue value={props.defaultModel} />
        </SettingsRow>
        <SettingsRow label="默认执行器" description="Builder 会话显示 Claude Code，其他 Agent 可单独覆盖。">
          <SettingValue value={props.defaultExecutor} />
        </SettingsRow>
        <SettingsRow label="工具调用展示" description="Read、rg、Shell、Write、Browser 等工具以统一步骤块渲染。">
          <SettingSegment options={['摘要', '详情']} active={props.toolCallDisplay} onChange={(v) => props.onChangeSetting('toolCallDisplay', v)} />
        </SettingsRow>
        <SettingsRow label="深度思考" description="运行中展示摘要，展开后显示完整推理块。">
          <SettingSegment options={['隐藏', '摘要', '完整']} active={props.deepThinkingDisplay} onChange={(v) => props.onChangeSetting('deepThinkingDisplay', v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="权限策略">
        {(PERMISSION_ROWS).map(([tool, value, desc]) => (
          <SettingsRow key={tool} label={tool} description={desc} wide>
            <SettingSegment
              options={['允许', '需确认', '禁止']}
              active={props.permissions[tool] ?? value}
              onChange={(v) => props.onChangeSetting(`perm_${tool}`, v)}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
    </>
  );
}

function LocalDevPane(props: SettingsPageProps): React.ReactElement {
  return (
    <>
      <SettingsSection title="本地预览">
        <SettingsRow label="Vite 地址" description="用于实时预览 AgentHub Desktop design demo。">
          <SettingPath value={props.vitePreviewUrl} onCopy={() => props.onChangeSetting('copy_viteUrl', props.vitePreviewUrl)} />
        </SettingsRow>
        <SettingsRow label="工作区" description="当前设计 demo 仓库路径。">
          <SettingPath value={props.workspacePath} onCopy={() => props.onChangeSetting('copy_workspacePath', props.workspacePath)} />
        </SettingsRow>
        <SettingsRow label="目标项目" description="后续迁移到真实 AgentHub Desktop 的参考项目。">
          <SettingPath value={props.targetProjectPath} onCopy={() => props.onChangeSetting('copy_targetProjectPath', props.targetProjectPath)} />
        </SettingsRow>
        <SettingsRow label="热更新覆盖层" description="保留 Vite 错误 overlay，开发时能直接看到语法问题。">
          <SettingSwitch active={props.hrmOverlayEnabled} onChange={(v) => props.onChangeSetting('hrmOverlayEnabled', v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="调试">
        <SettingsRow label="视觉 QA" description="需要时用浏览器截图检查桌面和窄宽布局。">
          <SettingValue value={props.visualQaMode} />
        </SettingsRow>
        <SettingsRow label="日志级别" description="仅 demo 前端事件和交互状态。">
          <SettingSegment options={['错误', '标准', '详细']} active={props.logLevel} onChange={(v) => props.onChangeSetting('logLevel', v)} />
        </SettingsRow>
        <SettingsRow label="设计系统校验" description="重大 UI 改动后再跑设计治理脚本，日常迭代保持轻量。">
          <SettingValue value={props.designSystemValidation} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function StatesPane(props: SettingsPageProps): React.ReactElement {
  return (
    <>
      <SettingsSection title="状态策略">
        <SettingsRow label="空状态" description="说明当前为空，并提供一个明确下一步。">
          <SettingSwitch active={props.stateStrategies.empty} onChange={(v) => props.onChangeSetting('stateStrategy_empty', v)} />
        </SettingsRow>
        <SettingsRow label="无效状态" description="链接失效、权限不足和数据过期使用 warning 语义。">
          <SettingSwitch active={props.stateStrategies.invalid} onChange={(v) => props.onChangeSetting('stateStrategy_invalid', v)} />
        </SettingsRow>
        <SettingsRow label="404 状态" description="项目归档、页面移动或不存在时给出返回路径。">
          <SettingSwitch active={props.stateStrategies.missing} onChange={(v) => props.onChangeSetting('stateStrategy_missing', v)} />
        </SettingsRow>
      </SettingsSection>

      <section className={styles.stateSystem}>
        <div className={styles.sectionTitleRow}>
          <h2>状态组件预览</h2>
          <span>Design System</span>
        </div>
        <div className={styles.stateGrid}>
          <StatePanel
            kind="empty"
            label="空列表"
            title="还没有云文档"
            copy="创建第一份文档或从本地上传文件。"
            actionLabel="新建文档"
            onAction={() => props.onChangeSetting('action_state_empty', '新建文档')}
          />
          <StatePanel
            kind="invalid"
            label="无效状态"
            title="链接已失效"
            copy="该分享链接过期，或你没有访问权限。"
            actionLabel="请求权限"
            onAction={() => props.onChangeSetting('action_state_invalid', '请求权限')}
          />
          <StatePanel
            kind="missing"
            label="404"
            title="页面不存在"
            copy="该项目页可能已归档、删除或移动。"
            actionLabel="返回项目"
            onAction={() => props.onChangeSetting('action_state_missing', '返回项目')}
          />
        </div>
      </section>
    </>
  );
}

const PANE_RENDERERS: Record<SettingsPaneId, React.FC<SettingsPageProps>> = {
  appearance: AppearancePane,
  notify: NotifyPane,
  agent: AgentDefaultsPane,
  local: LocalDevPane,
  states: StatesPane,
};

/* ═══════════════════════════════════════════════════════════════════════
   Main export
   ═══════════════════════════════════════════════════════════════════════ */

export function SettingsPage(props: SettingsPageProps): React.ReactElement {
  const { activePane, spaceTitle, spaceMeta, onSelectPane } = props;
  const meta = PANE_META[activePane] ?? PANE_META.appearance;
  const PaneContent = PANE_RENDERERS[activePane] ?? PANE_RENDERERS.appearance;

  return (
    <section className={styles.page}>
      {/* ── Left nav ── */}
      <aside className={styles.nav}>
        <div className={styles.navTitle}>设置</div>
        <input
          className={styles.navSearch}
          type="search"
          placeholder="搜索设置项"
        />
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`${styles.navRow}${activePane === item.id ? ` ${styles.navRowActive}` : ''}`}
            type="button"
            onClick={() => onSelectPane(item.id)}
          >
            <NavGlyph name={item.glyph} />
            {item.label}
          </button>
        ))}
        <div className={styles.navCaption}>当前空间</div>
        <SettingsScopeRow title={spaceTitle} meta={spaceMeta} />
        <SettingsScopeRow title="TokenDance" meta="组织空间" />
        <SettingsScopeRow title="Delicious233" meta="当前用户" />
      </aside>

      {/* ── Right main ── */}
      <main className={styles.main}>
        <div className={styles.head}>
          <div>
            <h1 className={styles.headTitle}>{meta.title}</h1>
            <p className={styles.headSubcopy}>{meta.description}</p>
          </div>
          <button className={styles.iconAction} type="button" aria-label="设置更多">
            <DesignNavIcon name="settings" size={16} />
          </button>
        </div>
        <PaneContent {...props} />
      </main>
    </section>
  );
}
