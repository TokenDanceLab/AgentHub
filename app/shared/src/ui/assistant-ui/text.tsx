import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';

const zh: Record<string, string> = {
  'Message input': '输入框', 'Send a message...': '输入消息…', 'Send message': '发送消息',
  'Stop generating': '停止生成', 'Cancel sending': '取消发送', 'Copy': '复制', 'Edit': '编辑',
  'Refresh': '重新生成', 'More': '更多', 'Previous': '上一条', 'Next': '下一条',
  'Scroll to bottom': '回到底部', 'Add Attachment': '添加附件', 'Loading conversation': '正在加载对话',
  'Load earlier messages': '加载更早的消息', 'Loading earlier messages': '正在加载更早的消息',
  'Cancel': '取消', 'Update': '保存修改', 'Export as Markdown': '导出 Markdown',
  'Assistant is working': 'Agent 正在回复', 'Reasoning': '思考过程',
  'Start a conversation': '开始对话', 'Message sent; the agent has not started.': '消息已发送，Agent 尚未开始。',
  'Retry agent': '重试 Agent', 'Allow': '允许', 'Deny': '拒绝', 'Checkpoint': '检查点',
  'Loading…': '加载中…', 'Preview unavailable': '预览不可用',
};

/** Translate registry copy without changing the upstream interaction components. */
export function useAssistantText() {
  const { i18n } = useTranslation();
  const chinese = (i18n.resolvedLanguage ?? i18n.language ?? '').startsWith('zh');
  return useCallback((text: string) => chinese ? zh[text] ?? text : text, [chinese]);
}

export function AssistantText({ children }: { children: string }) {
  const t = useAssistantText();
  return <>{t(children)}</>;
}
