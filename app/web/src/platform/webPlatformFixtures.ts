import {
  createWorkbenchDemoStore,
  demoWorkbenchAgents,
  resolveDemoWorkbenchTranscript,
} from '@shared/demo';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';

const demoStore = createWorkbenchDemoStore();

export const webConversations: WorkbenchConversation[] = demoStore.conversations;
export const webAgents: WorkbenchAgent[] = demoWorkbenchAgents;
export const webTranscript: TranscriptBlock[] = resolveDemoWorkbenchTranscript('builder');

export const webHubEmptyConversation: WorkbenchConversation = {
  id: 'hub-empty-workspace',
  title: 'Hub 工作台',
  kind: 'group',
  subtitle: '暂无 Hub 会话',
};

export const webHubEmptyTranscript: TranscriptBlock[] = [
  {
    id: 'web-hub-empty',
    kind: 'text',
    author: { id: 'hub', name: 'Hub', role: 'system' },
    text: 'Hub session 已连接，暂无可显示会话。',
  },
];
