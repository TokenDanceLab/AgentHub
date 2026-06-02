import type { ChatMessage } from '@/components/ChatView.types';

export function getMessageText(message: ChatMessage | undefined): string | null {
  const text = message?.blocks.find((block) => block.kind === 'text')?.content.trim();
  return text ? text : null;
}

export function findRetryPrompt(
  messages: ChatMessage[],
  messageId?: string,
): { prompt: string; sourceMessageId: string } | null {
  const targetIndex = messageId
    ? messages.findIndex((message) => message.id === messageId)
    : messages.length - 1;
  if (targetIndex < 0) return null;

  const target = messages[targetIndex];
  if (target?.role === 'user') {
    const prompt = getMessageText(target);
    return prompt ? { prompt, sourceMessageId: target.id } : null;
  }

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role !== 'user') continue;
    const prompt = getMessageText(candidate);
    if (prompt) return { prompt, sourceMessageId: candidate.id };
  }

  return null;
}

export function truncateForDraft(value: string, maxLength = 900): string {
  const normalized = value.replace(/\s+\n/g, '\n').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function buildForkDraft(args: {
  sourceTitle: string;
  sourceThreadId?: string;
  messages: ChatMessage[];
  messageId?: string;
}): string {
  const targetIndex = args.messageId
    ? args.messages.findIndex((message) => message.id === args.messageId)
    : args.messages.length - 1;
  const scopedMessages = targetIndex >= 0 ? args.messages.slice(0, targetIndex + 1) : args.messages;
  const retryPrompt = findRetryPrompt(scopedMessages);
  const parts = [
    `Forked from: ${args.sourceTitle}${args.sourceThreadId ? ` (${args.sourceThreadId})` : ''}`,
    '',
    'Continue from this request:',
    retryPrompt ? truncateForDraft(retryPrompt.prompt) : 'Summarize the useful context from the previous thread and continue.',
  ];
  return parts.join('\n');
}
