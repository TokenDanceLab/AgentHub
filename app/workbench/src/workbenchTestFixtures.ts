/**
 * Shared data fixtures for the AgentHubWorkbench integration suite (#1763).
 * Pure data only — no React components, no vi.mock, no render harnesses — so
 * any workbench test can reuse them without importing the integration file.
 */

import type { WorkbenchAgent } from '@shared/platform/types';
import type { TranscriptBlock } from '@shared/transcript/types';

export const workbenchAgents: WorkbenchAgent[] = [
  {
    id: 'builder',
    name: 'Builder',
    description: '代码实现',
    status: 'available',
    model: 'glm-5.1',
    runtimeId: 'claude-code',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: '架构复核',
    status: 'available',
    model: 'deepseek-v4-pro',
    runtimeId: 'claude-code',
  },
];

export const workbenchTranscript: TranscriptBlock[] = [
  {
    id: 'msg-1',
    kind: 'text',
    author: { id: 'user', name: 'Delicious233', role: 'human' },
    text: '全面参考 tokendance-design/desktop',
  },
  {
    id: 'tool-1',
    kind: 'tool_call',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    toolName: 'Read',
    status: 'completed',
    evidenceRefs: [
      { id: 'run-v4', kind: 'run', label: 'Run v4', status: 'running' },
      { id: 'ev-tool', kind: 'tool', label: 'Read desktop/index.html', status: 'completed' },
    ],
  },
  {
    id: 'run-session-1',
    kind: 'run_session',
    author: { id: 'hub', name: 'Hub replay', role: 'system' },
    title: 'Hub replay for desktop run',
    status: 'running',
    meta: 'same Hub task projected from Edge run',
    runId: 'run-v4',
    taskId: 'task-v4',
    edgeRunId: 'edge-run-v4',
    adapterId: 'codex',
    deviceId: 'desktop-device-1',
    sourceLabel: 'Hub replay',
    modeLabel: 'Replay',
    targetLabel: 'Edge run evidence',
  },
  {
    id: 'thinking-1',
    kind: 'thinking',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    content: '正在分析 Desktop/Web shared UI 与 design demo 的消息块差距。',
    isThinking: true,
  },
  {
    id: 'route-1',
    kind: 'route_decision',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    action: 'fanout',
    targetAgent: 'Reviewer',
    summary: '把页面路由、消息块和 floating layer 拆成可验证切片。',
  },
  {
    id: 'subagent-1',
    kind: 'subagent',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '复核 blocks 对齐',
    worker: 'Reviewer',
    status: 'running',
    summary: '检查 Thinking、Subagent、Result 等设计块是否进入 shared transcript。',
    runId: 'review-v4-blocks',
  },
  {
    id: 'timeline-1',
    kind: 'agent_timeline',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '运行时间线',
    items: [
      { status: 'completed', label: '初始化会话', detail: '模型、工具权限和当前项目上下文已加载' },
      { status: 'running', label: '进入代码定位阶段', detail: '读取消息模型和 SQLite 索引入口' },
    ],
  },
  {
    id: 'child-1',
    kind: 'child_agent',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'Browser QA 截图验证',
    agent: 'Browser QA',
    status: 'completed',
    summary: '确认 Desktop/Web 消息列能显示新增块。',
    runId: 'browser-qa-v4',
    parentRunId: 'run-v4',
  },
  {
    id: 'context-1',
    kind: 'context_usage',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    inputTokens: 38400,
    outputTokens: 6200,
    contextLimit: 200000,
    cost: '$0.44',
    modelLabel: 'GLM-5.1 / 200k',
  },
  {
    id: 'diff-1',
    kind: 'diff',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'app/workbench/src/RightInspector.tsx',
    files: ['app/workbench/src/RightInspector.tsx'],
    evidenceRefs: [
      { id: 'ev-file', kind: 'file', label: 'app/workbench/src/RightInspector.tsx' },
    ],
  },
  {
    id: 'artifact-1',
    kind: 'artifact',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'visual-smoke-desktop.png',
    evidenceRefs: [
      {
        id: 'ev-artifact',
        kind: 'artifact',
        label: 'visual-smoke-desktop.png',
        status: 'completed',
      },
    ],
  },
  {
    id: 'result-1',
    kind: 'result',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    success: true,
    duration: '8m12s',
    turns: 7,
    summary: '协作进度 78% · Builder 完成 · Reviewer 复核中。',
  },
];
