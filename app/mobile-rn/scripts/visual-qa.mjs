import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const allowCustomPreview = process.env.AGENTHUB_MOBILE_ALLOW_CUSTOM_PREVIEW === '1';
const port = Number.parseInt(process.env.AGENTHUB_MOBILE_PREVIEW_PORT ?? '5177', 10);
const baseUrl = process.env.AGENTHUB_MOBILE_PREVIEW_URL ?? `http://127.0.0.1:${port}`;
const mockHubPort = Number.parseInt(process.env.AGENTHUB_MOBILE_MOCK_HUB_PORT ?? '8088', 10);
const mockHubBaseUrl = process.env.AGENTHUB_MOBILE_MOCK_HUB_URL ?? `http://127.0.0.1:${mockHubPort}`;
const screenshotDir = path.join(projectRoot, 'screenshots', 'visual-qa');
const serverLogLimit = 80;
const minimumReadableFontSize = 11;
const minimumTouchTargetSize = 44;
const minimumLightSurfaceLuminance = 210;
const fromCodePoints = (...codePoints) => String.fromCodePoint(...codePoints);
const forbiddenPrivacyText = [
  fromCodePoints(0x5510, 0x4e01),
  fromCodePoints(0x5cb3, 0x9e93),
  fromCodePoints(0x59, 0x75, 0x65, 0x6c, 0x75),
  '真实姓名',
  'real name',
  'localhost',
  '127.0.0.1',
  'REST',
  'WebSocket',
  'event stream',
  '/v1/',
];
const sourceDesignHygieneRoots = [
  'src/components/primitives',
  'src/components/layout',
  'src/screens',
];
const sourceDesignHygieneRules = [
  {
    id: 'hardcoded-hex-color',
    pattern: /#[0-9A-Fa-f]{3,8}/,
    message: 'hardcoded hex colors belong in src/theme/tokens.ts',
  },
  {
    id: 'hardcoded-rgba',
    pattern: /rgba?\(/,
    message: 'raw rgb/rgba colors belong in src/theme/tokens.ts',
  },
  {
    id: 'raw-shadow-style',
    pattern: /\b(?:shadowColor|shadowOpacity|shadowRadius|shadowOffset)\b|\belevation\s*:/,
    message: 'shadow must be consumed through theme tokens or Surface elevation',
  },
  {
    id: 'negative-letter-spacing',
    pattern: /letterSpacing\s*:\s*-/,
    message: 'negative letter spacing is forbidden by the design contract',
  },
  {
    id: 'decorative-gradient',
    pattern: /linear-gradient|radial-gradient|gradient/i,
    message: 'decorative gradients are forbidden on mobile workbench surfaces',
  },
  {
    id: 'viewport-scaled-type',
    pattern: /fontSize\s*:\s*[^,\n]*(?:width|height|Dimensions\.get|useWindowDimensions)/,
    message: 'font size must not scale directly with viewport dimensions',
  },
];

const scenes = [
  {
    name: 'phone-home-zh-light-390x844',
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    path: '/',
    expectedTexts: ['Delicious233', 'AgentHub Mobile Workbench', 'AgentHub Design Contract'],
    forbiddenTexts: ['#'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['消息', '云文档', '任务', '项目', '更多'],
    actions: [],
  },
  {
    name: 'phone-home-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    expectedTexts: ['Delicious233', 'TokenDance', 'AgentHub Mobile Workbench', 'AgentHub Design Contract'],
    forbiddenTexts: ['#'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    actions: [],
  },
  {
    name: 'phone-chat-zh-light-390x844',
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=chat',
    expectedTexts: ['工作流', 'AgentHub Mobile 工作台视觉校准'],
    forbiddenTexts: ['Emoji', 'Mention', 'Voice input', 'Attach image', 'Text format', 'Aa', 'WebSocket 正在重连'],
    expectTabsHidden: true,
    actions: [{ text: 'AgentHub Mobile Workbench' }],
  },
  {
    name: 'phone-chat-evidence-inspector-zh-light-390x844',
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=chat',
    readyTextPatterns: ['AgentHub Mobile Workbench'],
    expectedTexts: ['证据检查器', '变更文件', '浏览器预览'],
    forbiddenTexts: ['localhost', '127.0.0.1', 'REST', 'WebSocket', '/v1/'],
    expectTabsHidden: true,
    actions: [
      { text: 'AgentHub Mobile Workbench' },
      { role: 'button', namePattern: 'Open evidence inspector|打开证据检查器' },
    ],
  },
  {
    name: 'phone-tasks-zh-light-390x844',
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=tasks',
    readyTextPatterns: ['AgentHub 任务', '我负责的'],
    expectedTexts: ['AgentHub 任务', '我负责的', '我关注的', '列表', '证据文件'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['消息', '云文档', '任务', '项目', '更多'],
    actions: [],
  },
  {
    name: 'phone-account-drawer-zh-light-390x844',
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    path: '/',
    expectedTexts: ['身份与会话', 'TokenDance ID', 'AgentHub', 'Agent Profiles', '切换工作区', 'Delicious233'],
    expectTabsHidden: true,
    actions: [
      { role: 'button', namePattern: 'Open account drawer|打开账号抽屉' },
    ],
  },
  {
    name: 'phone-account-drawer-en-oled-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    expectedTexts: ['Identity and session', 'TokenDance ID', 'AgentHub', 'Agent Profiles', 'Switch workspace', 'OLED selected'],
    expectTabsHidden: true,
    expectedDarkSurfaceMaxLuminance: 20,
    actions: [
      { role: 'button', namePattern: 'Open account drawer|打开账号抽屉' },
      { role: 'button', namePattern: '^OLED$' },
    ],
  },
  {
    name: 'tablet-tasks-zh-light-768x1024',
    locale: 'zh-CN',
    viewport: { width: 768, height: 1024 },
    path: '/',
    search: '?tab=tasks',
    readyTextPatterns: ['AgentHub 任务', '我负责的'],
    expectedTexts: ['AgentHub 任务', '我负责的', '我关注的', '列表', '证据文件'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['消息', '云文档', '任务', '项目', '更多'],
    actions: [],
  },
  {
    name: 'tablet-chat-split-zh-light-768x1024',
    locale: 'zh-CN',
    viewport: { width: 768, height: 1024 },
    path: '/',
    search: '?tab=chat',
    expectedTexts: ['AgentHub Mobile Workbench', 'Hub sender identity', 'AgentHub Mobile 工作台视觉校准'],
    forbiddenTexts: ['返回消息'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['消息', '云文档', '任务', '项目', '更多'],
    actions: [],
  },
  {
    name: 'tablet-chat-split-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?tab=chat',
    expectedTexts: ['AgentHub Mobile Workbench', 'Hub sender identity', 'AgentHub Mobile 工作台视觉校准'],
    forbiddenTexts: ['Back to messages'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    actions: [],
  },
  {
    name: 'tablet-chat-inspector-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?tab=chat&thread=mobile-design&run=run-mobile-design',
    expectedTexts: [
      'AgentHub Mobile Workbench',
      'AgentHub Mobile 工作台视觉校准',
      '审查 AgentHub Mobile 工作台视觉校准',
      'Run inspector',
      'Overview',
      'Files',
      'Browser',
      'AgentHub Mobile 工作台视觉校准',
      'Review approval',
      '设计系统进入移动端视觉审查。',
      'TokenDance ID identity',
      'Sync status',
    ],
    forbiddenTexts: ['Back to messages'],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    actions: [],
  },
  {
    name: 'tablet-chat-inspector-files-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?tab=chat&thread=mobile-design&run=run-mobile-design',
    expectedTexts: [
      'Run inspector',
      'Files',
      'Changed files',
      'Read-only file preview',
      'Diff preview',
      'Mobile tablet inspector keeps AgentHub evidence semantics.',
      'app/mobile-rn/package.json',
      'app/mobile-rn/src/theme/tokens.ts',
      'app/mobile-rn/src/components/primitives/Button.tsx',
    ],
    forbiddenTexts: ['Back to messages', 'VS Code', 'Visual Studio', 'Cursor', 'Git Bash', 'WSL', 'Android Studio', 'Ctrl+P', 'Ctrl+T'],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [{ role: 'tab', namePattern: '^Files$' }],
  },
  {
    name: 'tablet-chat-inspector-browser-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?tab=chat&thread=mobile-design&run=run-mobile-design',
    expectedTexts: [
      'Run inspector',
      'Browser',
      'Browser preview',
      'AgentHub Mobile preview',
      'AgentHub Mobile preview is ready for visual QA.',
      'Remote target status',
      'Mobile workspace',
    ],
    forbiddenTexts: ['Back to messages', 'Local Vite', 'VS Code', 'Visual Studio', 'Cursor', 'Git Bash', 'WSL', 'Android Studio', 'Ctrl+P', 'Ctrl+T'],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [{ role: 'tab', namePattern: '^Browser$' }],
  },
  {
    name: 'tablet-file-preview-many-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?scenario=previewMatrix&tab=chat&thread=preview-file-many',
    readyTextPatterns: ['File preview matrix', 'Run inspector'],
    expectedTexts: [
      'File preview matrix',
      'Changed files',
      'Read-only file preview',
      'app/mobile-rn/src/App.tsx',
      '+2 more files',
      '@@ -437,8 +437,22 @@ function TabletInspectorFiles',
      '- const previewFile = run.changedFiles[0];',
      '+ const previewFile = run.filePreview?.selectedPath ?? run.changedFiles[0];',
    ],
    forbiddenTexts: ['Back to messages', 'Bearer', 'token=', 'stack trace', 'raw server response'],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [{ role: 'tab', namePattern: '^Files$' }],
  },
  {
    name: 'tablet-file-preview-empty-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?scenario=previewMatrix&tab=chat&thread=preview-file-empty',
    readyTextPatterns: ['Empty file preview', 'Run inspector'],
    expectedTexts: ['Empty file preview', 'No changed files', '0 file'],
    forbiddenTexts: ['Read-only file preview', 'Bearer', 'token='],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [{ role: 'tab', namePattern: '^Files$' }],
  },
  {
    name: 'tablet-browser-preview-loading-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?scenario=previewMatrix&tab=chat&thread=preview-file-many',
    readyTextPatterns: ['File preview matrix', 'Run inspector'],
    expectedTexts: ['Browser preview', 'Preview loading', 'AgentHub artifact booting'],
    forbiddenTexts: ['Bearer', 'token=', 'stack trace', 'raw server response'],
    forbiddenTextsInTestIds: [
      { testId: 'tablet-browser-preview-loading', texts: ['Preview error'] },
    ],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [{ role: 'tab', namePattern: '^Browser$' }],
  },
  {
    name: 'tablet-browser-preview-ready-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?scenario=previewMatrix&tab=chat&thread=preview-browser-ready',
    readyTextPatterns: ['Browser preview ready', 'Run inspector'],
    expectedTexts: ['Browser preview', 'Preview ready', 'AgentHub Mobile docs preview'],
    forbiddenTexts: ['Bearer', 'token=', 'stack trace', 'raw server response'],
    forbiddenTextsInTestIds: [
      { testId: 'tablet-browser-preview-ready', texts: ['Preview error'] },
    ],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [{ role: 'tab', namePattern: '^Browser$' }],
  },
  {
    name: 'tablet-browser-preview-error-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?scenario=previewMatrix&tab=chat&thread=preview-browser-error',
    readyTextPatterns: ['Browser preview error', 'Run inspector'],
    expectedTexts: ['Browser preview', 'Preview error', 'Artifact preview unavailable', 'Retry preview'],
    forbiddenTexts: ['Bearer', 'token=', 'stack trace', 'raw server response'],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [{ role: 'tab', namePattern: '^Browser$' }],
  },
  {
    name: 'tablet-browser-no-preview-en-light-1024x768',
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?scenario=previewMatrix&tab=chat&thread=preview-file-empty',
    readyTextPatterns: ['Empty file preview', 'Run inspector'],
    expectedTexts: ['Browser preview', 'No browser preview', 'No artifact evidence has been attached to this AgentHub task yet.'],
    forbiddenTexts: ['Bearer', 'token=', 'stack trace', 'raw server response'],
    forbiddenTextsInTestIds: [
      { testId: 'tablet-browser-preview-empty', texts: ['Preview error'] },
    ],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [{ role: 'tab', namePattern: '^Browser$' }],
  },
  {
    name: 'phone-more-zh-light-390x844',
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=more',
    readyTextPatterns: ['AgentHub 工作台', 'Profile 与账号'],
    expectedTexts: ['AgentHub 工作台', '联系人', 'Agent Profiles', '设置', 'Profile 与账号'],
    forbiddenTexts: ['Feishu', 'Lark', 'GitHub', 'Google'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['消息', '云文档', '任务', '项目', '更多'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'phone-docs-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=docs',
    readyTextPatterns: ['AgentHub Docs', 'Recent'],
    expectedTexts: ['AgentHub Docs', 'Recent', 'Owned', 'Shared', 'Starred', 'Task evidence'],
    forbiddenTexts: ['Feishu', 'Lark', 'GitHub', 'Google'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'phone-settings-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=settings',
    readyTextPatterns: ['AgentHub Settings', 'Workspace settings'],
    expectedTexts: ['AgentHub Settings', 'Workspace settings', 'Approval policy', 'Docs and evidence'],
    forbiddenTexts: ['Feishu', 'Lark', 'GitHub', 'Google'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'phone-agents-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=agents',
    readyTextPatterns: ['Agent Profiles', 'Installed'],
    expectedTexts: ['Agent Profiles', 'Installed', 'Market', 'Policy', 'Tools', 'Models', 'Audit', 'AgentHub Profile'],
    forbiddenTexts: ['Claude Code', 'OpenCode', 'Codex'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'phone-projects-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=projects',
    readyTextPatterns: ['AgentHub Projects', 'Overview'],
    expectedTexts: ['AgentHub Projects', 'Overview', 'Runs', 'Artifacts', 'Archive', 'Project settings', 'AgentHub Mobile Workbench', 'TokenDance Review Space'],
    forbiddenTexts: ['execution target', 'runtime', 'model'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'phone-empty-queue-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=empty',
    expectedTexts: ['No active AgentHub messages'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    actions: [],
  },
  {
    name: 'phone-offline-chat-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=offline',
    expectedTexts: ['AgentHub recovery chat', 'Hub session recovery is needed'],
    expectTabsHidden: true,
    actions: [],
  },
  {
    name: 'phone-notification-intent-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=notification',
    expectedTexts: ['Review AgentHub mobile approval', 'Changed files'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    actions: [],
  },
  {
    name: 'phone-deeplink-run-chat-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=deeplink',
    expectedTexts: ['AgentHub deep link target', 'AgentHub deep linked run'],
    expectTabsHidden: true,
    actions: [],
  },
  {
    name: 'phone-send-error-retry-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=sendError',
    expectedTexts: ['AgentHub retry chat', 'Retry'],
    expectTabsHidden: true,
    actions: [],
  },
  {
    name: 'phone-send-pending-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=sendPending',
    readyTextPatterns: ['AgentHub message delivery', 'Sending AgentHub message'],
    expectedTexts: ['AgentHub message delivery', 'Sending AgentHub message', 'Hub delivery acknowledgement'],
    forbiddenTexts: ['Message failed', 'Retry'],
    expectTabsHidden: true,
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'phone-composer-actions-reduced-motion-en-light-390x844',
    locale: 'en-US',
    reducedMotion: true,
    forbidCssMotion: true,
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?tab=chat',
    readyTextPatterns: ['AgentHub Mobile Workbench'],
    expectedTexts: [
      'Composer actions',
      'Evidence',
      'Review mode',
      'Agent picker',
      'Format',
      'Attach changed files, screenshots, or browser preview evidence to the message.',
    ],
    forbiddenTexts: ['Emoji', 'Voice input', 'Attach image', 'Text format'],
    expectTabsHidden: true,
    actions: [
      { text: 'AgentHub Mobile Workbench' },
      { role: 'button', namePattern: '^More actions$' },
    ],
  },
  {
    name: 'phone-keyboard-send-pending-en-light-390x560',
    locale: 'en-US',
    viewport: { width: 390, height: 560 },
    path: '/',
    search: '?scenario=sendPending',
    readyTextPatterns: ['AgentHub message delivery', 'Sending AgentHub message'],
    expectedTexts: ['AgentHub message delivery', 'Sending AgentHub message', 'Hub delivery acknowledgement'],
    forbiddenTexts: ['Message failed'],
    expectTabsHidden: true,
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'tablet-composer-actions-split-reduced-motion-en-light-1024x768',
    locale: 'en-US',
    reducedMotion: true,
    forbidCssMotion: true,
    viewport: { width: 1024, height: 768 },
    path: '/',
    search: '?tab=chat&thread=mobile-design&run=run-mobile-design',
    readyTextPatterns: ['AgentHub Mobile Workbench', 'Run inspector'],
    expectedTexts: [
      'AgentHub Mobile Workbench',
      'Run inspector',
      'Composer actions',
      'Evidence',
      'Review mode',
      'Agent picker',
      'Format',
    ],
    forbiddenTexts: ['Back to messages', 'Emoji', 'Voice input', 'Attach image', 'Text format'],
    expectedPaneTestIds: [
      'tablet-thread-list-pane',
      'tablet-thread-transcript-pane',
      'tablet-thread-inspector-pane',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    actions: [{ role: 'button', namePattern: '^More actions$' }],
  },
  {
    name: 'phone-keyboard-send-error-zh-light-390x560',
    locale: 'zh-CN',
    viewport: { width: 390, height: 560 },
    path: '/',
    search: '?scenario=sendError',
    readyTextPatterns: ['AgentHub retry chat', '消息发送失败'],
    expectedTexts: ['AgentHub retry chat', '消息发送失败，可重试'],
    expectTabsHidden: true,
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'phone-approval-confirm-approve-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=approvalPending&sheet=approveConfirm',
    readyTextPatterns: ['Confirm approval', 'AgentHub Mobile 工作台视觉校准'],
    expectedTexts: [
      'Confirm approval',
      'Review the changed files, scope, and risk before approving this AgentHub task.',
      'AgentHub Mobile 工作台视觉校准',
      '设计系统进入移动端视觉审查。',
      'Approve',
      'Cancel',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    actions: [],
  },
  {
    name: 'phone-approval-confirm-reject-zh-light-390x844',
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=approvalPending&sheet=rejectConfirm',
    readyTextPatterns: ['确认拒绝', 'AgentHub Mobile 工作台视觉校准'],
    expectedTexts: [
      '确认拒绝',
      '拒绝此 AgentHub 任务，并保留运行状态以便继续修正。',
      'AgentHub Mobile 工作台视觉校准',
      '拒绝',
      '取消',
    ],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['消息', '云文档', '任务', '项目', '更多'],
    actions: [],
  },
  {
    name: 'phone-approval-submit-error-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=approvalError&sheet=approvalError',
    readyTextPatterns: ['Approval submit failed'],
    expectedTexts: [
      'Approval submit failed',
      'Hub did not accept the approval update.',
      'Retry',
      'Cancel',
      '审查 AgentHub Mobile 工作台视觉校准',
    ],
    forbiddenTexts: ['Bearer', 'token=', 'stack trace', 'raw server response'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    actions: [],
  },
  {
    name: 'phone-approval-resolved-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=approvalResolved',
    readyTextPatterns: ['Mobile design cleanup approved', 'Approval resolved'],
    expectedTexts: ['Mobile design cleanup approved', 'Approval resolved', 'Changed files'],
    forbiddenTexts: ['Reject'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['Chats', 'Docs', 'Tasks', 'Projects', 'More'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'phone-diff-preview-en-light-390x844',
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    path: '/',
    search: '?scenario=diffPreview',
    readyTextPatterns: ['AgentHub diff preview', 'Mobile chat and task diff preview'],
    expectedTexts: ['AgentHub diff preview', 'Mobile chat and task diff preview', 'screens/ChatScreen.tsx'],
    forbiddenTexts: ['P0（6项）', '综合评分'],
    expectTabsHidden: true,
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
  {
    name: 'tablet-diff-preview-zh-light-768x1024',
    locale: 'zh-CN',
    viewport: { width: 768, height: 1024 },
    path: '/',
    search: '?scenario=diffPreview&tab=tasks',
    readyTextPatterns: ['Review mobile diff preview', '变更文件'],
    expectedTexts: ['Review mobile diff preview', '变更文件', 'screens/TasksScreen.tsx'],
    expectedTabCount: 5,
    expectedBottomTabLabels: ['消息', '云文档', '任务', '项目', '更多'],
    expectedLightSurfaceMinLuminance: minimumLightSurfaceLuminance,
    actions: [],
  },
];

async function isServerReady() {
  try {
    const response = await fetch(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function isMockHubReady() {
  try {
    const response = await fetch(`${mockHubBaseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function startServer() {
  const command = process.env.npm_execpath ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const args = process.env.npm_execpath ? [process.env.npm_execpath, 'dev:web'] : ['dev:web'];
  const logs = [];
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      BROWSER: 'none',
      CI: '1',
      EXPO_NO_TELEMETRY: '1',
    },
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const appendLog = (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      logs.push(line);
      if (logs.length > serverLogLimit) {
        logs.shift();
      }
    }
  };

  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);

  return { child, logs };
}

function startMockHub() {
  const logs = [];
  const child = spawn(process.execPath, ['scripts/mock-hub.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AGENTHUB_MOBILE_MOCK_HUB_PORT: String(mockHubPort),
      CI: '1',
    },
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const capture = (chunk) => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      logs.push(line);
      if (logs.length > serverLogLimit) {
        logs.shift();
      }
    }
  };

  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  return { child, logs };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
    return;
  }

  await terminateProcessTree(child);
}

async function terminateProcessTree(child) {
  const exited = waitForExit(child, 5_000);

  try {
    if (child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    child.kill('SIGTERM');
  }

  if (await exited) {
    return;
  }

  try {
    if (child.pid) {
      process.kill(-child.pid, 'SIGKILL');
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    child.kill('SIGKILL');
  }

  await waitForExit(child, 2_000);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const done = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', done);
      child.off('error', done);
    };

    child.once('exit', done);
    child.once('error', done);
  });
}

async function waitForServer(logs) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isServerReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${baseUrl}\n${logs.join('\n')}`);
}

async function waitForMockHub(logs) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isMockHubReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for mock Hub ${mockHubBaseUrl}\n${logs.join('\n')}`);
}

function buildSceneUrl(scene) {
  const url = new URL(baseUrl);

  if (scene.path) {
    url.pathname = scene.path.startsWith('/') ? scene.path : `/${scene.path}`;
  }

  if (scene.search) {
    url.search = scene.search.startsWith('?') ? scene.search : `?${scene.search}`;
  }

  return url.toString();
}

async function waitForSceneReady(page, scene) {
  const readinessPatterns = scene.readyTextPatterns ?? [];
  const fallbackPattern = 'Alice|AgentHub Mobile Workbench|AgentHub Mobile 工作台视觉校准|AgentHub|TokenDance';
  const pattern = readinessPatterns.length > 0 ? readinessPatterns.join('|') : fallbackPattern;

  await page.getByText(new RegExp(pattern, 'i')).first().waitFor({ timeout: 60_000 });
}

async function collectSourceFiles(relativeDir) {
  const absoluteDir = path.join(projectRoot, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(relativePath));
      continue;
    }
    if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

async function assertSourceDesignHygiene() {
  const failures = [];
  const sourceFiles = (await Promise.all(sourceDesignHygieneRoots.map(collectSourceFiles))).flat();

  for (const relativeFile of sourceFiles) {
    const content = await readFile(path.join(projectRoot, relativeFile), 'utf8');
    const lines = content.split(/\r?\n/);
    for (const [lineIndex, line] of lines.entries()) {
      for (const rule of sourceDesignHygieneRules) {
        if (rule.pattern.test(line)) {
          failures.push(`${relativeFile}:${lineIndex + 1}: ${rule.id}: ${rule.message}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Mobile source design hygiene failed:\n${failures.join('\n')}`);
  }
}

async function openScene(context, scene, onPage) {
  const page = await context.newPage();
  onPage?.(page);
  await page.setViewportSize(scene.viewport);
  await page.goto(buildSceneUrl(scene), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForSceneReady(page, scene);

  for (const action of scene.actions) {
    if ('role' in action) {
      const name = 'namePattern' in action ? new RegExp(action.namePattern, 'i') : action.name;
      await page.getByRole(action.role, { name }).click();
    } else if ('textPattern' in action) {
      await page.getByText(new RegExp(action.textPattern, 'i')).click();
    } else {
      await page.getByText(action.text, { exact: true }).click();
    }
  }

  for (const expectedText of scene.expectedTexts ?? []) {
    await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 30_000 });
  }

  await page.waitForTimeout(500);
  return page;
}

async function probePage(page) {
  return page.evaluate((minFontSize) => {
    const isVisibleElement = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
        && rect.width > 0
        && rect.height > 0;
    };

    const normalizeText = (text) => text.replace(/\s+/g, ' ').trim();
    const maxDurationMs = (value) => Math.max(
      0,
      ...value.split(',').map((part) => {
        const duration = part.trim();
        if (!duration) {
          return 0;
        }
        if (duration.endsWith('ms')) {
          return Number.parseFloat(duration);
        }
        if (duration.endsWith('s')) {
          return Number.parseFloat(duration) * 1000;
        }
        return 0;
      }).filter(Number.isFinite),
    );
    const parseCssRgb = (color) => {
      const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)$/);
      if (!match) {
        return null;
      }

      const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
      if (alpha <= 0) {
        return null;
      }

      return {
        raw: color,
        red: Number.parseInt(match[1], 10),
        green: Number.parseInt(match[2], 10),
        blue: Number.parseInt(match[3], 10),
        alpha,
      };
    };
    const compositeOverWhite = (channel, alpha) => (channel * alpha) + (255 * (1 - alpha));
    const luminance = (rgb) => {
      const red = compositeOverWhite(rgb.red, rgb.alpha);
      const green = compositeOverWhite(rgb.green, rgb.alpha);
      const blue = compositeOverWhite(rgb.blue, rgb.alpha);

      return Math.round((0.2126 * red + 0.7152 * green + 0.0722 * blue) * 10) / 10;
    };

    const visibleTextBlocks = [];
    const smallTextBlocks = [];
    const backgroundSamples = [];
    const motionStyleSamples = [];
    const accessibleTexts = [];
    const visibleElements = Array.from(document.body.querySelectorAll('*')).filter(isVisibleElement);
    for (const element of visibleElements) {
      const style = window.getComputedStyle(element);
      const rgb = parseCssRgb(style.backgroundColor);
      for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
        const value = element.getAttribute(attribute);
        if (value) {
          accessibleTexts.push(normalizeText(value));
        }
      }
      if (!rgb) {
        continue;
      }

      const transitionMs = maxDurationMs(style.transitionDuration);
      const animationMs = maxDurationMs(style.animationDuration);
      if ((transitionMs > 0 || animationMs > 0) && motionStyleSamples.length < 8) {
        motionStyleSamples.push({
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute('data-testid') ?? null,
          transitionDuration: style.transitionDuration,
          animationDuration: style.animationDuration,
        });
      }

      const rect = element.getBoundingClientRect();
      backgroundSamples.push({
        color: rgb.raw,
        luminance: luminance(rgb),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }

    const textElements = Array.from(document.body.querySelectorAll('*')).filter((element) => {
      if (!isVisibleElement(element)) {
        return false;
      }

      const tagName = element.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'svg', 'path'].includes(tagName)) {
        return false;
      }

      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => normalizeText(node.textContent ?? ''))
        .filter(Boolean)
        .join(' ');

      return ownText.length > 0;
    });

    for (const element of textElements) {
      const text = normalizeText(
        Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join(' '),
      );
      if (!text) {
        continue;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const fontSize = Number.parseFloat(style.fontSize);
      const block = {
        text,
        fontSize: Number.isFinite(fontSize) ? Math.round(fontSize * 10) / 10 : null,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      visibleTextBlocks.push(block);

      if (block.fontSize !== null && block.fontSize < minFontSize) {
        smallTextBlocks.push(block);
      }
    }

    const tabRects = Array.from(document.querySelectorAll('[role="tab"]')).filter(isVisibleElement).map((tab) => {
      const rect = tab.getBoundingClientRect();
      return {
        label: tab.textContent?.trim() ?? '',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
      };
    });
    const bottomTabRects = tabRects.filter((tab) => tab.bottom >= window.innerHeight - 112);
    const paneRects = {};
    const searchableTextByTestId = {};
    for (const element of Array.from(document.querySelectorAll('[data-testid]')).filter(isVisibleElement)) {
      const testId = element.getAttribute('data-testid');
      if (!testId) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      paneRects[testId] = {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      searchableTextByTestId[testId] = normalizeText(element.textContent ?? '');
    }
    const visibleText = visibleTextBlocks.map((block) => block.text).join('\n');
    const searchableText = [...visibleTextBlocks.map((block) => block.text), ...accessibleTexts].join('\n');
    const significantBackgroundSamples = backgroundSamples
      .filter((sample) => sample.width >= 44 && sample.height >= 44)
      .sort((left, right) => left.luminance - right.luminance)
      .slice(0, 8);

    return {
      bodyTextLength: visibleText.length,
      bodyText: visibleText,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      locale: navigator.language,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      tabCount: tabRects.length,
      tabRects,
      bottomTabCount: bottomTabRects.length,
      bottomTabRects,
      paneRects,
      searchableTextByTestId,
      smallTextBlocks,
      visibleTextBlocks,
      accessibleTexts,
      searchableText,
      reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      motionStyleSamples,
      significantBackgroundSamples,
      darkestSignificantBackground: significantBackgroundSamples[0] ?? null,
    };
  }, minimumReadableFontSize);
}

async function run() {
  if (!allowCustomPreview && (port !== 5177 || process.env.AGENTHUB_MOBILE_PREVIEW_URL)) {
    throw new Error('Mobile visual QA must use http://127.0.0.1:5177 unless AGENTHUB_MOBILE_ALLOW_CUSTOM_PREVIEW=1 is set.');
  }

  await assertSourceDesignHygiene();
  await mkdir(screenshotDir, { recursive: true });

  let ownedMockHub;
  if (!(await isMockHubReady())) {
    ownedMockHub = startMockHub();
    await waitForMockHub(ownedMockHub.logs);
  }

  let ownedServer;
  if (!(await isServerReady())) {
    ownedServer = startServer();
    await waitForServer(ownedServer.logs);
  }

  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];
  const results = [];

  try {
    for (const scene of scenes) {
      const context = await browser.newContext({
        locale: scene.locale ?? 'en-US',
        reducedMotion: scene.reducedMotion ? 'reduce' : 'no-preference',
      });
      const page = await openScene(context, scene, (scenePage) => {
        scenePage.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
        });
        scenePage.on('pageerror', (error) => {
          consoleErrors.push(error.message);
        });
      });
      const screenshotPath = path.join(screenshotDir, `${scene.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const probe = await probePage(page);
      results.push({ ...scene, screenshotPath, probe });
      await context.close();
    }
  } finally {
    await browser.close();
    await stopServer(ownedServer?.child);
    await stopServer(ownedMockHub?.child);
  }

  const failures = [];
  for (const result of results) {
    if (result.probe.bodyTextLength < 100) {
      failures.push(`${result.name}: rendered text is unexpectedly sparse`);
    }
    if (result.probe.horizontalOverflow) {
      failures.push(`${result.name}: viewport has horizontal overflow`);
    }
    if (result.locale && result.probe.locale !== result.locale) {
      failures.push(`${result.name}: expected locale ${result.locale}, got ${result.probe.locale}`);
    }
    if (result.reducedMotion && !result.probe.reduceMotion) {
      failures.push(`${result.name}: expected prefers-reduced-motion: reduce`);
    }
    if (result.forbidCssMotion && result.probe.motionStyleSamples.length > 0) {
      failures.push(`${result.name}: CSS transition/animation remains active under reduced motion: ${JSON.stringify(result.probe.motionStyleSamples)}`);
    }
    if (result.expectTabsHidden && result.probe.bottomTabCount !== 0) {
      failures.push(`${result.name}: bottom tabs should be hidden, found ${result.probe.bottomTabCount}`);
    }
    if (typeof result.expectedTabCount === 'number' && result.probe.bottomTabCount !== result.expectedTabCount) {
      failures.push(`${result.name}: expected ${result.expectedTabCount} bottom tabs, found ${result.probe.bottomTabCount}`);
    }
    for (const expectedLabel of result.expectedBottomTabLabels ?? []) {
      if (!result.probe.bottomTabRects.some((tab) => tab.label.includes(expectedLabel))) {
        failures.push(`${result.name}: missing bottom tab label "${expectedLabel}"`);
      }
    }
    if (result.expectedPaneTestIds) {
      const paneRects = result.expectedPaneTestIds.map((testId) => ({
        testId,
        rect: result.probe.paneRects[testId],
      }));
      for (const pane of paneRects) {
        if (!pane.rect) {
          failures.push(`${result.name}: missing pane with testID "${pane.testId}"`);
          continue;
        }
        if (pane.rect.width < 240 || pane.rect.height < 500) {
          failures.push(`${result.name}: pane "${pane.testId}" is too small (${pane.rect.width}x${pane.rect.height})`);
        }
      }

      const availablePaneRects = paneRects.filter((pane) => pane.rect);
      for (let index = 1; index < availablePaneRects.length; index += 1) {
        const previous = availablePaneRects[index - 1];
        const current = availablePaneRects[index];
        if (current.rect.left < previous.rect.right - 1) {
          failures.push(
            `${result.name}: pane "${current.testId}" overlaps or appears before "${previous.testId}"`,
          );
        }
      }

      const tabletListPane = result.probe.paneRects['tablet-thread-list-pane'];
      if (tabletListPane && result.probe.bottomTabRects.length > 0) {
        for (const tab of result.probe.bottomTabRects) {
          if (tab.right > tabletListPane.right + 1) {
            failures.push(
              `${result.name}: bottom tab "${tab.label}" extends outside tablet list pane (${tab.right} > ${tabletListPane.right})`,
            );
          }
        }
      }
    }
    for (const expectedText of result.expectedTexts ?? []) {
      if (!result.probe.bodyText.toLowerCase().includes(expectedText.toLowerCase())) {
        failures.push(`${result.name}: missing expected text "${expectedText}"`);
      }
    }
    if (
      typeof result.expectedDarkSurfaceMaxLuminance === 'number'
      && (
        !result.probe.darkestSignificantBackground
        || result.probe.darkestSignificantBackground.luminance > result.expectedDarkSurfaceMaxLuminance
      )
    ) {
      failures.push(
        `${result.name}: expected a dark/OLED surface at luminance <= ${result.expectedDarkSurfaceMaxLuminance}, got ${
          result.probe.darkestSignificantBackground
            ? `${result.probe.darkestSignificantBackground.color} (${result.probe.darkestSignificantBackground.luminance})`
            : 'no significant background sample'
        }`,
      );
    }
    if (
      typeof result.expectedLightSurfaceMinLuminance === 'number'
      && (
        !result.probe.darkestSignificantBackground
        || result.probe.darkestSignificantBackground.luminance < result.expectedLightSurfaceMinLuminance
      )
    ) {
      failures.push(
        `${result.name}: expected a light surface at luminance >= ${result.expectedLightSurfaceMinLuminance}, got ${
          result.probe.darkestSignificantBackground
            ? `${result.probe.darkestSignificantBackground.color} (${result.probe.darkestSignificantBackground.luminance})`
            : 'no significant background sample'
        }`,
      );
    }
    for (const forbiddenText of [...forbiddenPrivacyText, ...(result.forbiddenTexts ?? [])]) {
      if (result.probe.searchableText.includes(forbiddenText)) {
        failures.push(`${result.name}: forbidden text "${forbiddenText}" is visible or exposed to accessibility text`);
      }
    }
    for (const scopedCheck of result.forbiddenTextsInTestIds ?? []) {
      const scopedText = result.probe.searchableTextByTestId[scopedCheck.testId];
      if (typeof scopedText !== 'string') {
        failures.push(`${result.name}: missing scoped text target "${scopedCheck.testId}"`);
        continue;
      }
      for (const forbiddenText of scopedCheck.texts) {
        if (scopedText.includes(forbiddenText)) {
          failures.push(`${result.name}: forbidden text "${forbiddenText}" is visible in "${scopedCheck.testId}"`);
        }
      }
    }
    for (const tab of result.probe.tabRects) {
      if (tab.width < minimumTouchTargetSize || tab.height < minimumTouchTargetSize) {
        failures.push(`${result.name}: tab "${tab.label}" is below ${minimumTouchTargetSize}px touch target (${tab.width}x${tab.height})`);
      }
    }
    for (const block of result.probe.smallTextBlocks) {
      failures.push(`${result.name}: text "${block.text}" is below ${minimumReadableFontSize}px font threshold (${block.fontSize}px)`);
    }
  }

  if (consoleErrors.length > 0) {
    failures.push(`browser console errors:\n${consoleErrors.join('\n')}`);
  }

  const report = {
    baseUrl,
    screenshotDir,
    scenes: results.map((result) => ({
      name: result.name,
      viewport: result.probe.viewport,
      screenshotPath: result.screenshotPath,
      locale: result.probe.locale,
      tabCount: result.probe.tabCount,
      tabRects: result.probe.tabRects,
      bottomTabCount: result.probe.bottomTabCount,
      bottomTabRects: result.probe.bottomTabRects,
      paneRects: result.probe.paneRects,
      reduceMotion: result.probe.reduceMotion,
      motionStyleSamples: result.probe.motionStyleSamples,
      smallTextBlocks: result.probe.smallTextBlocks,
      horizontalOverflow: result.probe.horizontalOverflow,
      darkestSignificantBackground: result.probe.darkestSignificantBackground,
    })),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
