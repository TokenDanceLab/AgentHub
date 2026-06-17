#!/usr/bin/env python3
"""Replace vi.mock with vi.hoisted approach in AgentHubWorkbench.test.tsx."""
import sys

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

import_start = content.find("import { sharedWorkbenchResources } from '../i18n/workbench';")
next_mock = content.find("vi.mock('@lobehub/icons'")
before = content.rfind("\n", 0, next_mock)

replacement = """/* ── Build translation maps inside vi.hoisted so they are available before
     Vitest hoists the vi.mock factory.  We inline the zh-CN values from
     sharedWorkbench and chatview namespaces to avoid importing modules
     inside the mock factory (which would fail due to hoisting). ── */

const { workbenchZhMap, chatviewZhMap } = vi.hoisted(() => {
  function flatten(o: Record<string, unknown>, prefix = ''): Record<string, string> {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      const next = prefix ? prefix + '.' + k : k;
      if (typeof v === 'string') m[next] = v;
      else if (v && typeof v === 'object') Object.assign(m, flatten(v as Record<string, unknown>, next));
    }
    return m;
  }
  const wb: Record<string, unknown> = {
    nav: { chat:'对话', contacts:'通讯录', docs:'云文档', agents:'Agent', agentMarket:'Agent 市场', projects:'项目', runs:'任务', settings:'设置', search:'搜索' },
    navLabel: { chat:'消息', docs:'云文档' },
    composer: { placeholder:'发消息给 {{target}}', send:'发送消息', agentTarget:'Agent @{{agent}}' },
    composerModes: { ask:'询问', plan:'规划', deploy:'部署' },
    transcript: { dateTime:'{{date}} · {{time}}', timeline:'运行时间线', timelineItems:'{{count}} items', currentReasoning:'当前推理', reasoningSummary:'推理摘要', running:'运行中', pending:'待执行', completed:'完成', failed:'失败', readOnly:'只读' },
    actions: { copy:'复制', copyLink:'复制消息链接', forward:'转发', addTask:'添加任务', exportDoc:'导出文档', delete:'删除' },
    inspector: { overview:'概览', browser:'浏览器', files:'文件', collapsePanel:'收起右侧概览', expandPanel:'展开右侧概览', resize:'调整右侧栏宽度', closeTab:'关闭 {{label}}', tasks:'任务', resizeLabel:'调整右侧栏宽度', newWindow:'新建右侧窗口', restoreTab:'恢复 {{label}}', openFile:'打开文件 {{name}}', openDiff:'打开 diff {{name}}', openPreview:'打开预览 {{name}}', runEvidence:'运行证据', fileLabel:'文件', openArtifact:'打开产物 {{name}}', artifactMetadata:'产物 metadata {{name}}', noFileContent:'{{name}}\\n\\n暂无文件内容。', allClosed:'右侧窗口已关闭。使用 + 重新打开概览、浏览器或文件。', addMenu:'右侧窗口菜单' },
    sidebar: { resize:'调整最近频道宽度' },
    settings: { dataMode:'数据模式' },
    group: { agentProfile:'Agent 配置', sendMessage:'发送消息', copyLink:'复制链接' },
    taskList: { myTasks:'我负责的', watching:'我关注的', board:'看板', list:'列表' },
    header: { messages:'消息', docs:'云文档', collapseInspector:'收起概览', expandInspector:'展开概览' },
    filePreview: { readOnlyPreview:'只读预览', source:'源码', diff:'Diff', openWith:'打开方式' },
    browserPreview: { back:'后退', forward:'前进', refresh:'刷新', close:'关闭预览' },
    'actions.backToOverview': '返回概览',
    pinnedAnnouncement: { pin:'置顶', link:'链接' },
    profilePopover: { sendMessage:'发送消息', editProfile:'编辑资料', copyLink:'复制链接' },
    multiSelect: { copy:'复制', forward:'转发', delete:'删除', pin:'置顶', cancel:'取消', selected:'已选 {{count}} 条' },
    contextMenu: { copy:'复制', forward:'转发', pin:'置顶', delete:'删除', select:'选择', reply:'回复' },
    'settings.pane.appearance.title': '外观设置',
    'settings.pane.localDev.title': '本地开发设置',
    agents: { 'nav.installed':'已安装', 'nav.market':'Agent 市场', 'detail.tools':'工具权限', 'installed.search':'搜索已安装 Agent', 'installed.title':'Agent管理', 'market.title':'Agent 市场', 'market.search':'搜索 Agent', 'market.install':'安装', 'market.installed':'已安装' },
    contacts: { 'nav.internal':'组织内联系人', 'nav.external':'外部联系人', 'nav.newFriend':'新的联系人', 'search.placeholder':'搜索联系人' },
    tasks: { 'nav.all':'全部任务', 'nav.assigned':'分配给我', 'nav.created':'我创建的', 'nav.watching':'我关注的', 'view.list':'列表', 'view.board':'看板', 'view.timeline':'时间线', 'newTask':'新建任务', 'status.pending':'待执行', 'status.active':'进行中', 'status.done':'已完成', 'status.failed':'失败', 'status.cancelled':'已取消' },
    projects: { 'nav.all':'全部项目', 'nav.running':'运行中', 'nav.completed':'已完成', 'nav.archived':'已归档', 'tab.overview':'概览', 'tab.settings':'设置', 'tab.members':'成员', 'newProject':'新建项目' },
    docs: { 'tab.recent':'最近访问', 'tab.mine':'归我所有', 'tab.shared':'与我共享', 'tab.starred':'收藏', 'newDoc':'新建文档', 'search.placeholder':'搜索云文档' },
    'settings.nav.appearance': '外观', 'settings.nav.appearanceDesc': '主题、语言和界面风格',
    'settings.nav.notifications': '通知', 'settings.nav.notificationsDesc': '消息提醒和声音',
    'settings.nav.agentDefaults': 'Agent 默认值', 'settings.nav.agentDefaultsDesc': '运行引擎、模型和审批策略',
    'settings.nav.localDev': '本地开发', 'settings.nav.localDevDesc': 'Edge 连接、快捷键和调试选项',
    'settings.nav.stateComponents': '状态组件', 'settings.nav.stateComponentsDesc': '预览 Agent 运行状态卡片',
    'settings.moreButton.label': '设置更多',
    'globalRail.settings.label': '设置', 'globalRail.settings.title': '设置',
    'globalRail.toggleTheme.label': '切换主题', 'globalRail.toggleTheme.title': '切换主题',
  };
  return {
    workbenchZhMap: flatten(wb),
    chatviewZhMap: {
      'card.think.running': '深度思考',
      'card.think.done': '思考完成',
      'card.think.analyze': '当前推理',
      'card.think.analyzeDone': '推理完成',
      'card.think.fail': '思考失败',
      'card.tool.read':'阅读', 'card.tool.read.running':'正在阅读',
      'card.tool.grep':'搜索', 'card.tool.grep.running':'正在搜索',
      'card.tool.write':'写入', 'card.tool.write.running':'正在写入',
      'card.tool.result':'工具结果', 'card.tool.result.running':'正在运行',
      'card.tool.eslint':'eslint', 'card.tool.prettier':'prettier',
      'card.tool.tsc':'tsc --noEmit', 'card.tool.audit':'审计',
      'card.tool.check':'检查', 'card.tool.test':'测试', 'card.tool.lint':'检查',
      'card.tool.fail':'工具失败',
      'card.file.create':'创建', 'card.file.create.running':'正在创建',
      'card.file.modify':'修改', 'card.file.modify.running':'正在修改',
      'card.file.delete':'删除', 'card.file.delete.running':'正在删除',
      'card.file.fail':'文件操作失败',
      'card.sub.agent':'子 Agent', 'card.sub.agent.withName':'子 Agent · {name}',
      'card.sub.agent.running':'Agent · {name} 工作中', 'card.sub.agent.fail':'子 Agent 失败',
      'card.sub.agent.ok':'子 Agent 完成',
      'card.sub.task':'子任务', 'card.sub.task.withName':'子任务 · {name}',
      'card.sub.task.running':'子任务 · {name} 运行中', 'card.sub.task.fail':'子任务 失败',
      'card.sub.task.ok':'子任务 完成',
      'card.approval.title':'部署/写入审批', 'card.approval.waiting':'等待审批中...',
      'card.approval.ok':'权限检查通过', 'card.approval.fail':'审批被拒绝',
      'card.approval.approve':'批准', 'card.approval.deny':'拒绝',
      'card.deploy.ready':'预览已就绪', 'card.deploy.fail':'部署失败', 'card.deploy.running':'正在部署',
      'card.fail.retry':'重试', 'card.expand':'展开', 'card.collapse':'收起',
      'card.route.dag':'拆解完成 · 并行 + 串行', 'card.route.fail':'分派失败',
      'card.session.prefix':'会话', 'card.session.fail':'会话失败',
      'card.ctx.fail':'上下文耗尽', 'card.attachment.fail':'附件加载失败',
      'code.copy':'复制', 'transcript.empty':'暂无消息', 'chat.you':'你',
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        ...workbenchZhMap,
        ...chatviewZhMap,
        'composer.placeholder': '发消息给 {{target}}',
        'composer.send': '发送消息',
        'nav.contacts': '联系人',
      };
      const base = translations[key];
      if (base === undefined) return key;
      if (options) {
        return base.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
          String(options[name] ?? options[name.toLowerCase()] ?? `{{${name}}}`));
      }
      return base;
    },
    i18n: { language: 'zh' },
  }),
}));

"""

content = content[:import_start] + replacement + content[before+1:]
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('SUCCESS')
