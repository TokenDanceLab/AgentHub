export type SharedWorkbenchLanguage = 'zh' | 'en';

export const SHARED_WORKBENCH_I18N_NAMESPACE = 'sharedWorkbench';

export const sharedWorkbenchResources = {
  zh: {
    nav: {
      chat: '对话',
      contacts: '联系人',
      docs: '云文档',
      agents: 'Agent',
      tasks: '任务',
      projects: '项目',
      settings: '设置',
    },
    header: {
      messages: '消息',
      docs: '云文档',
      collapseInspector: '收起概览',
      expandInspector: '展开概览',
    },
    inspector: {
      overview: '概览',
      browser: '浏览器',
      files: '文件',
      tasks: '任务',
      artifacts: '产物',
      workspace: 'Builder 工作目录',
      primaryFile: '最终文件',
      workingFiles: '工作文件',
      emptyFiles: '暂无变更文件',
      browserReady: '浏览器预览已启用',
      browserWaiting: '等待 run 产出可预览地址或 artifact。',
      open: '打开',
      pendingIntegration: '待接入',
      resizeLabel: '调整右侧栏宽度',
      newWindow: '新建右侧窗口',
    },
    transcript: {
      dateTime: '{{date}} · {{time}}',
      timeline: '运行时间线',
      timelineItems: '{{count}} items',
      currentReasoning: '当前推理',
      reasoningSummary: '推理摘要',
      running: '运行中',
      pending: '待执行',
      completed: '完成',
      failed: '失败',
      readOnly: '只读',
    },
    composer: {
      placeholder: '发送给 {{target}}',
      send: '发送',
    },
    actions: {
      copy: '复制',
      copyLink: '复制消息链接',
      forward: '转发',
      addTask: '添加任务',
      exportDoc: '导出文档',
      delete: '删除',
      close: '关闭',
      backToOverview: '返回概览',
    },
  },
  en: {
    nav: {
      chat: 'Chats',
      contacts: 'Contacts',
      docs: 'Docs',
      agents: 'Agents',
      tasks: 'Tasks',
      projects: 'Projects',
      settings: 'Settings',
    },
    header: {
      messages: 'Messages',
      docs: 'Docs',
      collapseInspector: 'Collapse overview',
      expandInspector: 'Expand overview',
    },
    inspector: {
      overview: 'Overview',
      browser: 'Browser',
      files: 'Files',
      tasks: 'Tasks',
      artifacts: 'Artifacts',
      workspace: 'Builder workspace',
      primaryFile: 'Final file',
      workingFiles: 'Working files',
      emptyFiles: 'No changed files',
      browserReady: 'Browser preview is enabled',
      browserWaiting: 'Waiting for a run preview URL or artifact.',
      open: 'Open',
      pendingIntegration: 'Pending',
      resizeLabel: 'Resize right inspector',
      newWindow: 'New inspector window',
    },
    transcript: {
      dateTime: '{{date}} · {{time}}',
      timeline: 'Run timeline',
      timelineItems: '{{count}} items',
      currentReasoning: 'Current reasoning',
      reasoningSummary: 'Reasoning summary',
      running: 'Running',
      pending: 'Pending',
      completed: 'Completed',
      failed: 'Failed',
      readOnly: 'Read only',
    },
    composer: {
      placeholder: 'Message {{target}}',
      send: 'Send',
    },
    actions: {
      copy: 'Copy',
      copyLink: 'Copy message link',
      forward: 'Forward',
      addTask: 'Add task',
      exportDoc: 'Export doc',
      delete: 'Delete',
      close: 'Close',
      backToOverview: 'Back to overview',
    },
  },
} as const;

export type SharedWorkbenchResourceTree =
  (typeof sharedWorkbenchResources)[SharedWorkbenchLanguage];

export function flattenSharedWorkbenchResource(
  resource: SharedWorkbenchResourceTree,
  prefix = '',
): string[] {
  return Object.entries(resource).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') return [next];
    return flattenSharedWorkbenchResource(value as SharedWorkbenchResourceTree, next);
  });
}
