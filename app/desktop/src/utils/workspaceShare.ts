import type { ChatMessage, MessageBlock } from '@/components/ChatView.types';

export interface WorkspaceShareLabels {
  thread: string;
  agent: string;
  run: string;
  status: string;
  messages: string;
  noMessages: string;
  user: string;
  assistant: string;
  system: string;
  tool: string;
  file: string;
  code: string;
  fileCreated: string;
  fileModified: string;
  fileDeleted: string;
}

export interface WorkspaceShareInput {
  title: string;
  thread?: { id: string; title?: string };
  agent?: { id?: string; name: string };
  run?: { id: string; status: string };
  messages: ChatMessage[];
  labels: WorkspaceShareLabels;
  maxMessages?: number;
}

const DEFAULT_MAX_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 180;

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max = MAX_MESSAGE_CHARS): string {
  const normalized = compact(text);
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function safePath(path: string): string {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? path;
  }
  return path;
}

function fileActionLabel(action: 'created' | 'modified' | 'deleted', labels: WorkspaceShareLabels): string {
  if (action === 'created') return labels.fileCreated;
  if (action === 'deleted') return labels.fileDeleted;
  return labels.fileModified;
}

function formatBlock(block: MessageBlock, labels: WorkspaceShareLabels): string {
  if (block.kind === 'text') return block.content;
  if (block.kind === 'code') return labels.code;
  if (block.kind === 'tool_use') return `${labels.tool}: ${block.toolName}`;
  if (block.kind === 'file_change') return `${labels.file}: ${fileActionLabel(block.action, labels)} ${safePath(block.path)}`;
  if (block.kind === 'result') return labels.status;
  return '';
}

function messageRoleLabel(message: ChatMessage, labels: WorkspaceShareLabels): string {
  if (message.role === 'user') return labels.user;
  if (message.role === 'system') return labels.system;
  return message.agentName ?? labels.assistant;
}

export function buildWorkspaceShareText({
  title,
  thread,
  agent,
  run,
  messages,
  labels,
  maxMessages = DEFAULT_MAX_MESSAGES,
}: WorkspaceShareInput): string {
  const lines = [`AgentHub: ${title}`];

  if (thread) {
    const threadTitle = thread.title ? `${thread.title} (${thread.id})` : thread.id;
    lines.push(`${labels.thread}: ${threadTitle}`);
  }
  if (agent) lines.push(`${labels.agent}: ${agent.name}${agent.id ? ` (${agent.id})` : ''}`);
  if (run) {
    lines.push(`${labels.run}: ${run.id}`);
    lines.push(`${labels.status}: ${run.status}`);
  }

  const recentMessages = messages.slice(-maxMessages);
  lines.push(`${labels.messages}:`);
  const formattedMessages = recentMessages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      const text = truncate(
        message.blocks
          .map((block) => formatBlock(block, labels))
          .filter(Boolean)
          .join(' '),
      );
      return text ? `- ${messageRoleLabel(message, labels)}: ${text}` : null;
    })
    .filter((line): line is string => Boolean(line));

  if (formattedMessages.length === 0) {
    lines.push(`- ${labels.noMessages}`);
  } else {
    lines.push(...formattedMessages);
  }

  return lines.join('\n');
}
