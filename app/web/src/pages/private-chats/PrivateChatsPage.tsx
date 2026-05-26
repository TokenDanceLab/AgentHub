<<<<<<< HEAD
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { HubMessage, HubSession } from '@shared/index';
import { useHubIMSnapshot } from '../../hooks/useHubIMSnapshot';
import { useHubSession } from '../../hooks/useHubSession';

type Accent = 'blue' | 'cyan' | 'purple';

type Attachment = {
  name: string;
  detail: string;
};

type CodeBlock = {
  file: string;
  lines: string[];
};

type QuoteBlock = {
  title: string;
  body: string;
};

type Message = {
  id: string;
  author: string;
  role: string;
  time: string;
  side: 'left' | 'right';
  body: string;
  accent?: Accent;
  attachments?: Attachment[];
  code?: CodeBlock;
  quote?: QuoteBlock;
  isDraft?: boolean;
};

type Conversation = {
  id: string;
  name: string;
  initials: string;
  role: string;
  time: string;
  summary: string;
  unread: number;
  accent: Accent;
  messages: Message[];
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
  alpha: number;
};

type AttachmentOption = Attachment & {
  id: string;
  icon: string;
};

type ConversationSnapshot = Conversation & {
  allMessages: Message[];
  currentSummary: string;
  currentTime: string;
  currentUnread: number;
};

type Notice = {
  id: number;
  text: string;
  tone: 'info' | 'success';
};
=======
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Button, SearchInput } from '@shared/ui';
import { ParticleCanvas } from '@/components/ParticleCanvas';
import { WebLayout } from '@/components/WebLayout';
import styles from './PrivateChatsPage.module.css';
>>>>>>> origin/dev/delicious233

type HubConversationLabels = {
  agent: string;
  user: string;
  recalled: string;
  privateSession: string;
  privateSessionFallback: string;
  noRecentMessages: string;
};

<<<<<<< HEAD
const accentOptions: Accent[] = ['blue', 'cyan', 'purple'];
=======
type Conversation = {
  id: string; name: string; initials: string; role: string; time: string;
  summary: string; unread: number; accent: Accent; messages: Message[];
};

type AttachmentOption = Attachment & { id: string; icon: string };

type ConversationSnapshot = Conversation & {
  allMessages: Message[]; currentSummary: string; currentTime: string; currentUnread: number;
};

type Notice = { id: number; text: string; tone: 'info' | 'success' };

function formatClock(date = new Date()) {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function getLastMessageSummary(message: Message) {
  const prefix = message.attachments?.length ? `[${message.attachments.length} attachments] ` : '';
  return `${prefix}${message.body}`;
}

const conversations: Conversation[] = mockThreads.map((thread, ti) => {
  const threadMessages = mockMessages.filter((m) => m.threadId === thread.id);
  const accentOptions: Accent[] = ['blue', 'cyan', 'purple'];
  return {
    id: thread.id, name: thread.title ?? `Thread ${thread.id}`,
    initials: (thread.title ?? 'T').slice(0, 2).toUpperCase(),
    role: thread.projectId, time: '10:42',
    summary: thread.status === 'active' ? 'Active conversation' : 'Archived',
    unread: ti === 0 ? 2 : ti === 1 ? 0 : 1,
    accent: accentOptions[ti % accentOptions.length]!,
    messages: threadMessages.map((msg) => ({
      id: msg.id, author: msg.role === 'user' ? 'You' : 'Agent',
      role: msg.role === 'user' ? 'Owner' : 'Agent',
      time: '10:30',
      side: (msg.role === 'user' ? 'right' : 'left') as 'left' | 'right',
      body: msg.content,
      ...(msg.role === 'agent' ? { accent: accentOptions[ti % accentOptions.length] } : {}),
    })),
  };
});
>>>>>>> origin/dev/delicious233

const attachmentOptions: AttachmentOption[] = [
  { id: 'local-context', name: 'local-context.md', detail: 'queued', icon: 'description' },
  { id: 'selection-snippet', name: 'selection.tsx', detail: 'snippet', icon: 'code' },
  { id: 'handoff-checklist', name: 'handoff checklist', detail: 'note', icon: 'tag' },
];

<<<<<<< HEAD
function getLastMessageSummary(message: Message) {
  const prefix = message.attachments?.length ? `[${message.attachments.length} attachments] ` : '';
  return `${prefix}${message.body}`;
}

function messageMatchesQuery(message: Message, query: string) {
  if (!query) {
    return true;
  }

  const searchableText = [
    message.author,
    message.role,
    message.body,
    message.quote?.title,
    message.quote?.body,
    message.code?.file,
    ...(message.code?.lines ?? []),
    ...(message.attachments?.flatMap((attachment) => [attachment.name, attachment.detail]) ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return searchableText.includes(query);
}

function conversationMatchesQuery(conversation: ConversationSnapshot, query: string) {
  if (!query) {
    return true;
  }

  const searchableText = [
    conversation.name,
    conversation.initials,
    conversation.role,
    conversation.currentSummary,
    conversation.currentTime,
  ]
    .join(' ')
    .toLowerCase();

  return searchableText.includes(query) || conversation.allMessages.some((message) => messageMatchesQuery(message, query));
}

function parseMessageContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
    }
  } catch {
    // Hub text messages can be plain strings or JSON envelopes.
  }

  return content;
}

function formatHubTime(value?: string): string {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16) || '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initialsFromName(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return initials || 'PC';
}

function sessionName(session: HubSession, labels: HubConversationLabels): string {
  return session.name || `${labels.privateSessionFallback} ${session.session_id || session.id || ''}`.trim();
}

function messageFromHub(message: HubMessage, accent: Accent, labels: HubConversationLabels): Message {
  const isAgent = message.sender_type === 'agent';
  const isUser = message.sender_type === 'user';

  return {
    id: message.id,
    author: isAgent ? labels.agent : isUser ? labels.user : message.sender_type,
    body: message.recalled ? labels.recalled : parseMessageContent(message.content),
    role: `${message.content_type} / ${message.sender_type}`,
    side: isAgent ? 'left' : 'right',
    time: formatHubTime(message.created_at),
    ...(isAgent ? { accent } : {}),
  };
}

function conversationFromHubSession(
  session: HubSession,
  messages: HubMessage[],
  index: number,
  labels: HubConversationLabels,
): Conversation {
  const accent = accentOptions[index % accentOptions.length] ?? 'blue';
  const name = sessionName(session, labels);
  const sessionMessages = messages.map((message) => messageFromHub(message, accent, labels));
  const lastMessage = sessionMessages[sessionMessages.length - 1];

  return {
    accent,
    id: session.session_id || session.id || `hub-session-${index}`,
    initials: initialsFromName(name),
    messages: sessionMessages,
    name,
    role: labels.privateSession,
    summary: lastMessage?.body || session.announcement || labels.noRecentMessages,
    time: lastMessage?.time || formatHubTime(session.last_message_at ?? session.updated_at ?? session.created_at),
    unread: session.unread_count ?? 0,
  };
}

const pageStyles = `
  @import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap");
  @import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0,0");

  .pc-page {
    position: relative;
    height: 100%;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.16), transparent 28%),
      radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.14), transparent 30%),
      linear-gradient(135deg, var(--bg), var(--surface-alt));
    color: var(--text);
    font-family: "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .pc-particles {
    position: fixed;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    opacity: 0.72;
  }

  [data-theme="dark"] .pc-page {
    background:
      radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.1), transparent 28%),
      radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.1), transparent 30%),
      linear-gradient(135deg, var(--bg), var(--surface-alt));
  }

  .pc-symbol {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: "Material Symbols Rounded";
    font-size: 20px;
    font-style: normal;
    font-weight: 400;
    line-height: 1;
    font-variation-settings: "FILL" 0, "wght" 450, "GRAD" 0, "opsz" 24;
  }

  .pc-shell {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 280px minmax(480px, 1fr) 336px;
    gap: 18px;
    height: 100%;
    padding: 18px;
  }

  .pc-glass {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    box-shadow: 0 18px 48px var(--glass-shadow);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
  }

  .pc-panel {
    display: flex;
    min-height: 0;
    overflow: hidden;
    flex-direction: column;
  }

  .pc-sidebar {
    padding: 18px;
  }

  .pc-header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 68px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .pc-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .pc-brand-mark {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    color: var(--white);
    font-size: 16px;
    font-weight: 900;
    line-height: 1;
    border-radius: 10px;
    background: var(--accent-gradient);
    box-shadow: 0 10px 22px var(--brand-glow);
  }
  .pc-chat-header,
  .pc-context-header {
    justify-content: space-between;
  }

  .pc-title h1,
  .pc-title h2 {
    margin: 0;
    color: var(--text);
    font-size: 15px;
    line-height: 1.25;
  }

  .pc-brand h2 {
    margin: 0;
    color: var(--text);
    font-size: 15px;
    line-height: 1.25;
  }

  .pc-title .pc-brand-sub {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
  }

  .pc-eyebrow,
  .pc-section-title,
  .pc-meta {
    margin: 0 0 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .pc-title .pc-brand-sub {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    line-height: 1.236;
  }

  .pc-icon-button,
  .pc-tool-button,
  .pc-send-button,
  .pc-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    box-shadow: none;
    cursor: pointer;
  }

  .pc-icon-button,
  .pc-tool-button {
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    padding: 0;
  }

  .pc-icon-button.is-active,
  .pc-tool-button.is-active {
    border-color: var(--accent-border);
    background: var(--accent-light);
    color: var(--accent);
  }

  .pc-icon-button:disabled,
  .pc-tool-button:disabled,
  .pc-send-button:disabled,
  .pc-key-button:disabled {
    opacity: 0.46;
    cursor: not-allowed;
    box-shadow: none;
  }

  .pc-search {
    position: relative;
    padding: 12px 14px 8px;
  }

  .pc-search span {
    position: absolute;
    top: 21px;
    left: 25px;
    color: var(--text-muted);
    font-size: 18px;
  }

  .pc-search input {
    width: 100%;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: 0;
    padding: 0 12px 0 34px;
    background: var(--surface);
    color: var(--text);
  }

  .pc-filter-note {
    padding: 0 16px 8px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .pc-section-title {
    padding: 10px 16px 8px;
  }

  .pc-chat-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
    padding: 0 10px 16px;
  }

  .pc-chat-card {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-height: 64px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 10px;
    background: var(--surface);
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .pc-chat-card.is-active {
    border-color: var(--accent-border);
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(8, 145, 178, 0.08));
  }

  .pc-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    border-radius: 10px;
    background: var(--brand-gradient);
    color: var(--white);
    font-size: 12px;
    font-weight: 800;
    box-shadow: 0 10px 22px var(--shadow);
  }

  .pc-avatar.cyan {
    background: linear-gradient(135deg, var(--accent), var(--success-dot));
  }

  .pc-avatar.purple {
    background: var(--accent-gradient);
  }

  .pc-chat-card h3,
  .pc-message-meta strong {
    margin: 0;
    font-size: 13px;
    line-height: 1.2;
  }

  .pc-chat-card p {
    margin: 4px 0 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pc-time {
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .pc-unread {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    margin-top: 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--white);
    font-size: 11px;
    font-weight: 800;
  }

  .pc-chat-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .pc-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    background: var(--success-bg);
    color: var(--success);
    font-size: 11px;
    font-weight: 800;
  }

  .pc-status::before {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: currentColor;
    content: "";
  }

  .pc-actions,
  .pc-composer-tools,
  .pc-composer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pc-messages {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 18px 12px;
  }

  .pc-message-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    max-width: 78%;
  }

  .pc-message-row.is-mine {
    align-self: flex-end;
    grid-template-columns: minmax(0, 1fr) 36px;
  }

  .pc-message-row.is-mine .pc-avatar {
    grid-column: 2;
    grid-row: 1;
    background: var(--brand-gradient);
  }

  .pc-message-row.is-mine .pc-message-stack {
    grid-column: 1;
    grid-row: 1;
  }

  .pc-message-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .pc-message-row.is-mine .pc-message-meta {
    justify-content: flex-end;
  }

  .pc-key-button {
    border: 0;
    border-radius: 7px;
    padding: 3px 7px;
    background: var(--accent-lighter);
    color: var(--accent);
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
  }

  .pc-key-button.is-active {
    background: var(--accent-light);
    color: var(--accent);
  }

  .pc-confirm-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    border: 1px solid var(--accent-border);
    border-radius: 10px;
    padding: 9px 10px;
    background: var(--surface);
    color: var(--text-secondary);
    font-size: 12px;
  }

  .pc-confirm-bar.is-success {
    border-color: var(--success-border);
    background: var(--success-bg);
    color: var(--success);
  }

  .pc-confirm-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .pc-bubble {
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 12px 14px;
    background: var(--surface);
    box-shadow: none;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.5;
  }

  .pc-message-row.is-mine .pc-bubble {
    border-color: var(--accent-border);
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.92), rgba(8, 145, 178, 0.9));
    color: var(--white);
  }

  .pc-bubble.is-draft {
    border-style: dashed;
  }

  .pc-quote {
    margin-bottom: 10px;
    border-left: 3px solid var(--accent);
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--accent-lighter);
    color: var(--text-secondary);
  }

  .pc-code-card {
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--code-bg);
    color: var(--code-text);
  }

  .pc-code-card header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 34px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
    color: var(--code-text);
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
  }

  .pc-code-card pre {
    margin: 0;
    overflow-x: auto;
    padding: 10px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
  }

  .pc-code-card code {
    display: block;
    white-space: pre;
  }

  .pc-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .pc-attachment {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    background: var(--surface);
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
  }

  button.pc-attachment {
    cursor: pointer;
  }

  .pc-attachment.is-active {
    border-color: var(--accent-border);
    background: var(--accent-light);
    color: var(--accent);
    font-weight: 800;
  }

  .pc-composer-wrap {
    flex: 0 0 auto;
    padding: 0 18px 18px;
  }

  .pc-attachment-tray {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
    padding: 10px;
  }

  .pc-selected-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }

  .pc-composer {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: end;
    min-height: 88px;
    padding: 12px;
  }

  .pc-composer textarea {
    min-height: 58px;
    max-height: 130px;
    resize: none;
    border: 1px solid var(--border);
    border-radius: 10px;
    outline: 0;
    padding: 12px 14px;
    background: var(--surface);
    color: var(--text);
    line-height: 1.45;
  }

  .pc-send-button {
    height: 36px;
    gap: 8px;
    padding: 0 14px;
    border-color: var(--accent-border);
    background: var(--brand-gradient);
    color: var(--white);
    font-weight: 800;
  }

  .pc-context-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
  }

  .pc-mini-card {
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 12px;
    background: var(--surface);
  }

  .pc-mini-card h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }

  .pc-mini-card p,
  .pc-mini-card li {
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .pc-mini-card p {
    margin: 0;
  }

  .pc-mini-card ul {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pc-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .pc-chip {
    min-height: 24px;
    padding: 4px 9px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1;
    box-shadow: none;
  }

  .pc-progress {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--accent-light);
  }

  .pc-progress span {
    display: block;
    width: 68%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent), var(--accent), var(--accent));
  }

  .pc-empty {
    align-self: center;
    border-radius: 12px;
    padding: 14px 16px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 13px;
  }

  @media (max-width: 1180px) {
    .pc-shell {
      grid-template-columns: 260px minmax(0, 1fr);
    }

    .pc-context-panel {
      display: none;
    }

    .pc-message-row {
      max-width: 88%;
    }
  }

  @media (max-width: 820px) {
    .pc-page {
      overflow: auto;
    }

    .pc-shell {
      grid-template-columns: 1fr;
      min-height: auto;
      padding: 12px;
    }

    .pc-sidebar {
      max-height: 260px;
    }

    .pc-chat-panel {
      min-height: 680px;
    }

    .pc-composer {
      grid-template-columns: 1fr;
    }
  }
`;

function Avatar({ initials, accent = 'blue' }: { initials: string; accent?: Accent }) {
  return <span className={`pc-avatar ${accent}`}>{initials}</span>;
}

function Icon({ name }: { name: string }) {
  return (
    <span className="pc-symbol" aria-hidden="true">
      {name}
    </span>
  );
}

export function PrivateChatsPageInteractive() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { hasSession: hasHubSession, token } = useHubSession();
  const hubSnapshot = useHubIMSnapshot(token);
  const [activeChatId, setActiveChatId] = useState('');
=======
const initialUnreadByChat = conversations.reduce<Record<string, number>>((m, c) => { m[c.id] = c.unread; return m; }, {});

function messageMatchesQuery(msg: Message, q: string) {
  if (!q) return true;
  const txt = [msg.author, msg.role, msg.body, msg.quote?.title, msg.quote?.body, msg.code?.file, ...(msg.code?.lines ?? []), ...(msg.attachments?.flatMap((a) => [a.name, a.detail]) ?? [])].filter(Boolean).join(' ').toLowerCase();
  return txt.includes(q);
}

function conversationMatchesQuery(conv: ConversationSnapshot, q: string) {
  if (!q) return true;
  const txt = [conv.name, conv.initials, conv.role, conv.currentSummary, conv.currentTime].join(' ').toLowerCase();
  return txt.includes(q) || conv.allMessages.some((m) => messageMatchesQuery(m, q));
}

function accentClass(accent: Accent): string {
  return accent === 'cyan' ? String(styles.msgAvatarCyan ?? '') : accent === 'purple' ? String(styles.msgAvatarPurple ?? '') : '';
}

export function PrivateChatsPage() {
  const { t } = useTranslation();
  const [activeChatId, setActiveChatId] = useState(conversations[0]!.id);
>>>>>>> origin/dev/delicious233
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [keyOnly, setKeyOnly] = useState(false);
  const [keyedMessages, setKeyedMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
<<<<<<< HEAD
  const [readSessionIds, setReadSessionIds] = useState<Set<string>>(() => new Set());
=======
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>({});
  const [unreadByChat, setUnreadByChat] = useState<Record<string, number>>(initialUnreadByChat);
>>>>>>> origin/dev/delicious233
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);

  const { t } = useTranslation('privateChats');
  const hubConversationLabels = useMemo<HubConversationLabels>(
    () => ({
      agent: t('hub.agent'),
      user: t('hub.user'),
      recalled: t('hub.recalled'),
      privateSession: t('hub.privateSession'),
      privateSessionFallback: t('hub.privateSessionFallback'),
      noRecentMessages: t('hub.noRecentMessages'),
    }),
    [t],
  );
  const emptyConversationSnapshot = useMemo<ConversationSnapshot>(
    () => ({
      id: 'empty',
      name: t('sidebar.emptyTitle'),
      initials: 'NA',
      role: t('hub.privateSession'),
      time: '--:--',
      summary: t('hub.noConversationsSummary'),
      unread: 0,
      accent: 'blue',
      messages: [],
      allMessages: [],
      currentSummary: t('hub.noConversationsSummary'),
      currentTime: '--:--',
      currentUnread: 0,
    }),
    [t],
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const conversations = useMemo<Conversation[]>(
    () =>
      hubSnapshot.status === 'ready'
        ? hubSnapshot.sessions.map((session, index) =>
            conversationFromHubSession(
              session,
              hubSnapshot.messagesBySessionId[session.session_id || session.id || ''] ?? [],
              index,
              hubConversationLabels,
            ),
          )
        : [],
    [hubConversationLabels, hubSnapshot.messagesBySessionId, hubSnapshot.sessions, hubSnapshot.status],
  );
  const availableConversations = hasHubSession && hubSnapshot.status === 'ready' ? conversations : [];
  const isChatLocked = true;
  const chatStatusKey = !hasHubSession
    ? 'locked'
    : hubSnapshot.status === 'error'
      ? 'error'
      : hubSnapshot.status === 'loading'
        ? 'loading'
        : 'ready';

<<<<<<< HEAD
  const conversationSnapshots = useMemo<ConversationSnapshot[]>(
    () =>
      availableConversations.map((conversation) => {
        const allMessages = conversation.messages;
        const lastMessage = allMessages[allMessages.length - 1];

        return {
          ...conversation,
          allMessages,
          currentSummary: lastMessage ? getLastMessageSummary(lastMessage) : conversation.summary,
          currentTime: lastMessage?.time ?? conversation.time,
          currentUnread: readSessionIds.has(conversation.id) ? 0 : conversation.unread,
        };
      }),
    [availableConversations, readSessionIds],
  );

  const activeConversation = useMemo(
    () =>
      conversationSnapshots.find((conversation) => conversation.id === activeChatId) ??
      conversationSnapshots[0] ??
      emptyConversationSnapshot,
    [activeChatId, conversationSnapshots, emptyConversationSnapshot],
  );

  const filteredConversations = useMemo(
    () => conversationSnapshots.filter((conversation) => conversationMatchesQuery(conversation, normalizedSearch)),
    [conversationSnapshots, normalizedSearch],
  );

  const selectedAttachments = useMemo(
    () => attachmentOptions.filter((attachment) => selectedAttachmentIds.includes(attachment.id)),
    [selectedAttachmentIds],
  );

  const messages = useMemo(() => {
    const keyedFiltered = keyOnly
      ? activeConversation.allMessages.filter((message) => keyedMessages.includes(message.id))
      : activeConversation.allMessages;

    return keyedFiltered.filter((message) => messageMatchesQuery(message, normalizedSearch));
  }, [activeConversation, keyOnly, keyedMessages, normalizedSearch]);

  const activeKeyCount = useMemo(
    () => activeConversation.allMessages.filter((message) => keyedMessages.includes(message.id)).length,
    [activeConversation, keyedMessages],
  );

  const activeAttachments = useMemo(
    () =>
      activeConversation.allMessages
        .flatMap((message) => message.attachments ?? [])
        .concat(selectedAttachments.map(({ name, detail }) => ({ name, detail }))),
    [activeConversation, selectedAttachments],
  );

  const activeCodeBlock = useMemo(
    () => activeConversation.allMessages.find((message) => message.code)?.code,
    [activeConversation],
  );

  const reviewProgress = Math.min(
    100,
    Math.round(((activeKeyCount + selectedAttachments.length) /
      Math.max(activeConversation.allMessages.length + 2, 1)) * 100),
  );

  const hasComposerContent = draft.trim().length > 0 || selectedAttachments.length > 0;

  useEffect(() => {
    if (conversationSnapshots.length === 0) {
      if (activeChatId) setActiveChatId('');
      return;
    }
=======
  const conversationSnapshots = useMemo<ConversationSnapshot[]>(() => conversations.map((c) => {
    const all = [...c.messages, ...(localMessages[c.id] ?? [])];
    const last = all[all.length - 1];
    return { ...c, allMessages: all, currentSummary: last ? getLastMessageSummary(last) : c.summary, currentTime: last?.time ?? c.time, currentUnread: unreadByChat[c.id] ?? 0 };
  }), [localMessages, unreadByChat]);
>>>>>>> origin/dev/delicious233

    if (!conversationSnapshots.some((conversation) => conversation.id === activeChatId)) {
      setActiveChatId(conversationSnapshots[0]?.id ?? '');
    }
  }, [activeChatId, conversationSnapshots]);

  useEffect(() => {
<<<<<<< HEAD
    setKeyedMessages((current) => {
      const next = current.filter((messageId) =>
        conversationSnapshots.some((conversation) =>
          conversation.allMessages.some((message) => message.id === messageId),
        ),
      );
      if (next.length === current.length && next.every((messageId, index) => messageId === current[index])) {
        return current;
=======
    const stream = new MockEventStream();
    const conv = conversations.find((c) => c.id === activeChatId);
    if (!conv) return;
    const unsub = stream.onType('message.delta', (event) => {
      if (event.type === 'message.delta') {
        const delta = String(event.payload.delta ?? '');
        const msgId = String(event.payload.messageId ?? '');
        setLocalMessages((prev) => {
          const existing = prev[msgId] ?? [];
          const last = existing[existing.length - 1];
          if (last && last.isDraft) return { ...prev, [msgId]: [...existing.slice(0, -1), { ...last, body: last.body + delta }] };
          const draftMsg: Message = { id: msgId, author: 'Agent', role: 'Agent', time: formatClock(), side: 'left', accent: conv.accent, body: delta, isDraft: true };
          return { ...prev, [msgId]: [...existing, draftMsg] };
        });
>>>>>>> origin/dev/delicious233
      }
      return next;
    });
<<<<<<< HEAD
  }, [conversationSnapshots]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 3200);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const particleCount = 56;
    const particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frameId = 0;

    const makeParticle = (index: number): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: -0.18 + Math.random() * 0.36,
      vy: -0.18 - Math.random() * 0.48,
      radius: 1.6 + Math.random() * 2.6,
      hue: index % 3 === 0 ? 196 : 210,
      alpha: 0.18 + Math.random() * 0.2,
    });

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      if (particles.length === 0) {
        for (let index = 0; index < particleCount; index += 1) {
          particles.push(makeParticle(index));
        }
      }
    };

    const tick = () => {
      context.clearRect(0, 0, width, height);

      particles.forEach((particle, index) => {
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.x < -16) {
          particle.x = width + 16;
        }

        if (particle.x > width + 16) {
          particle.x = -16;
        }

        if (particle.y < -16) {
          particle.y = height + 16;
        }

        if (particle.y > height + 16) {
          particle.y = -16;
        }

        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fillStyle = `hsla(${particle.hue}, 84%, 48%, ${particle.alpha})`;
        context.fill();

        for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
          const next = particles[nextIndex];
          if (!next) {
            continue;
          }

          const dx = particle.x - next.x;
          const dy = particle.y - next.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 126) {
            context.beginPath();
            context.moveTo(particle.x, particle.y);
            context.lineTo(next.x, next.y);
            context.strokeStyle = `rgba(23, 105, 232, ${(1 - distance / 126) * 0.07})`;
            context.lineWidth = 1;
            context.stroke();
          }
        }
      });

      frameId = window.requestAnimationFrame(tick);
    };

    resize();
    tick();
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const showNotice = (text: string, tone: Notice['tone'] = 'info') => {
    setNotice({ id: Date.now(), text, tone });
  };

  const selectConversation = (chatId: string) => {
    const nextConversation = conversationSnapshots.find((conversation) => conversation.id === chatId);

    setActiveChatId(chatId);
    setReadSessionIds((current) => new Set(current).add(chatId));

    if (nextConversation?.currentUnread) {
      showNotice(t('notice.markedRead', { name: nextConversation.name }), 'success');
    }
  };

  const toggleAttachmentPanel = () => {
    setAttachmentsOpen((current) => !current);
  };

  const toggleAttachment = (attachmentId: string) => {
    const attachment = attachmentOptions.find((option) => option.id === attachmentId);
    const isSelected = selectedAttachmentIds.includes(attachmentId);

    setSelectedAttachmentIds((current) =>
      current.includes(attachmentId)
        ? current.filter((currentAttachmentId) => currentAttachmentId !== attachmentId)
        : [...current, attachmentId],
    );

    if (attachment) {
      showNotice(isSelected ? t('notice.removed', { name: attachment.name }) : t('notice.selected', { name: attachment.name }));
    }
  };

  const removeAttachment = (attachmentId: string) => {
    const attachment = attachmentOptions.find((option) => option.id === attachmentId);

    setSelectedAttachmentIds((current) =>
      current.filter((currentAttachmentId) => currentAttachmentId !== attachmentId),
    );
    showNotice(t('notice.attachmentRemoved', { name: attachment?.name ?? 'Attachment' }));
  };

  const toggleKeyedMessage = (messageId: string) => {
    const message = activeConversation.allMessages.find((currentMessage) => currentMessage.id === messageId);
    const isKeyed = keyedMessages.includes(messageId);

    setKeyedMessages((current) =>
      current.includes(messageId)
        ? current.filter((currentMessageId) => currentMessageId !== messageId)
        : [...current, messageId],
    );

    showNotice(
      isKeyed
        ? t('notice.removeKey', { author: message?.author ?? 'message' })
        : t('notice.markKey', { author: message?.author ?? 'message' }),
      isKeyed ? 'info' : 'success',
    );
  };

  const insertCodeSnippet = () => {
    setDraft((current) => `${current}${current ? '\n\n' : ''}\`\`\`tsx\n// paste selected snippet here\n\`\`\``);
    showNotice(t('notice.codeInserted'));
  };

  const quoteLatestMessage = () => {
    const source =
      [...activeConversation.allMessages].reverse().find((message) => keyedMessages.includes(message.id)) ??
      activeConversation.allMessages[activeConversation.allMessages.length - 1];

    if (!source) {
      return;
    }

    setDraft((current) => `${current}${current ? '\n\n' : ''}> ${source.body.slice(0, 120)}`);
    showNotice(t('notice.quoted', { author: source.author }));
  };

  const sendDraft = () => {
    if (isChatLocked) {
      showNotice(hasHubSession ? t('notice.readOnly') : t('notice.loginRequired'));
      return;
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    sendDraft();
  };

  return (
    <div className="pc-page">
      <style>{pageStyles}</style>
      <canvas ref={canvasRef} className="pc-particles" aria-hidden="true" />

      <div className="pc-shell">
        <aside className="pc-sidebar pc-panel pc-glass">
          <div className="pc-brand">
            <span className="pc-brand-mark">AH</span>
            <div className="pc-title">
              <h2>AGENTHUB</h2>
              <p className="pc-brand-sub">{t('brand.subtitle')}</p>
            </div>
          </div>

          <div className="pc-search">
            <Icon name="search" />
            <input
              aria-label={t('search.ariaLabel')}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('search.placeholder')}
              type="search"
              value={searchQuery}
            />
          </div>

          <div className="pc-section-title">{t('sidebar.title')}</div>
          {normalizedSearch ? (
            <div className="pc-filter-note">
              {t('search.filtering', { chatCount: filteredConversations.length, messageCount: messages.length, query: searchQuery.trim() })}
            </div>
          ) : null}
          <div className="pc-chat-list">
            {filteredConversations.length > 0 ? (
              filteredConversations.map((conversation) => (
                <button
                  className={`pc-chat-card ${conversation.id === activeConversation.id ? 'is-active' : ''}`}
                  key={conversation.id}
                  onClick={() => selectConversation(conversation.id)}
                  type="button"
                >
                  <Avatar initials={conversation.initials} accent={conversation.accent} />
                  <span>
                    <h3>{conversation.name}</h3>
                    <p>{conversation.currentSummary}</p>
                  </span>
                  <span>
                    <span className="pc-time">{conversation.currentTime}</span>
                    {conversation.currentUnread > 0 ? (
                      <span className="pc-unread">{conversation.currentUnread}</span>
                    ) : null}
                  </span>
                </button>
              ))
            ) : (
              <div className="pc-empty">{t('sidebar.empty')}</div>
            )}
          </div>
        </aside>

        <main className="pc-chat-panel pc-panel pc-glass">
          <header className="pc-header pc-chat-header">
            <div className="pc-chat-heading">
              <Avatar initials={activeConversation.initials} accent={activeConversation.accent} />
              <div className="pc-title">
                <h2>{activeConversation.name}</h2>
                <p>
                  {activeConversation.role} -{' '}
                  {chatStatusKey === 'error'
                    ? t('chat.error')
                    : hasHubSession
                      ? t('chat.readOnly')
                      : t('chat.loginRequired')}
                </p>
              </div>
              <span className="pc-status">
                {chatStatusKey === 'error'
                  ? t('status.error')
                  : chatStatusKey === 'loading'
                    ? t('status.loading')
                    : hasHubSession
                      ? t('status.readOnly')
                      : t('status.locked')}
              </span>
            </div>

            <div className="pc-actions">
              <button
                className={`pc-icon-button ${keyOnly ? 'is-active' : ''}`}
                disabled={activeConversation.allMessages.length === 0}
                onClick={() => setKeyOnly((current) => !current)}
                type="button"
                aria-pressed={keyOnly}
                aria-label={t('header.star')}
              >
                <Icon name="star" />
              </button>
              <button
                className={`pc-icon-button ${attachmentsOpen ? 'is-active' : ''}`}
                disabled={isChatLocked}
                onClick={toggleAttachmentPanel}
                type="button"
                aria-expanded={attachmentsOpen}
                aria-label={t('header.attachments')}
              >
                <Icon name="attach_file" />
              </button>
              <button
                className="pc-icon-button"
                onClick={() => showNotice(t('notice.moreActions'))}
                type="button"
                aria-label={t('header.more')}
              >
                <Icon name="more_horiz" />
              </button>
            </div>
          </header>

          <section className="pc-messages" aria-label={t('chat.messagesArea')}>
            {!hasHubSession ? (
              <div className="pc-empty">
                <strong>{t('locked.title')}</strong>
                <p>{t('locked.description')}</p>
              </div>
            ) : hubSnapshot.status === 'loading' ? (
              <div className="pc-empty">
                <strong>{t('loading.title')}</strong>
                <p>{t('loading.description')}</p>
              </div>
            ) : hubSnapshot.status === 'error' ? (
              <div className="pc-empty">
                <strong>{t('error.title')}</strong>
                <p>{t('error.description', { error: hubSnapshot.error })}</p>
              </div>
            ) : messages.length > 0 ? (
              messages.map((message) => {
                const isKeyed = keyedMessages.includes(message.id);

                return (
                  <article
                    className={`pc-message-row ${message.side === 'right' ? 'is-mine' : ''}`}
                    key={message.id}
                  >
                    <Avatar
                      initials={message.side === 'right' ? 'ME' : activeConversation.initials}
                      accent={message.side === 'right' ? 'purple' : message.accent ?? activeConversation.accent}
                    />
                    <div className="pc-message-stack">
                      <div className="pc-message-meta">
                        <strong>{message.author}</strong>
                        <span>{message.time}</span>
                        <span>{message.role}</span>
                        <button
                          className={`pc-key-button ${isKeyed ? 'is-active' : ''}`}
                          onClick={() => toggleKeyedMessage(message.id)}
                          type="button"
                          aria-pressed={isKeyed}
                        >
                          {isKeyed ? t('key.keyed') : t('key.markKey')}
                        </button>
                      </div>

                      <div className={`pc-bubble ${message.isDraft ? 'is-draft' : ''}`}>
                        {message.quote ? (
                          <div className="pc-quote">
                            <strong>{message.quote.title}</strong>
                            <br />
                            {message.quote.body}
                          </div>
                        ) : null}
                        {message.body}

                        {message.attachments ? (
                          <div className="pc-attachments">
                            {message.attachments.map((attachment) => (
                              <span className="pc-attachment" key={`${message.id}-${attachment.name}`}>
                                <Icon name="description" />
                                <span>
                                  {attachment.name} - {attachment.detail}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {message.code ? (
                          <div className="pc-code-card">
                            <header>
                              <span>{message.code.file}</span>
                              <span>{t('code.snippet')}</span>
                            </header>
                            <pre>
                              {message.code.lines.map((line, index) => (
                                <code key={`${message.id}-line-${index}`}>{line}</code>
                              ))}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="pc-empty">
                {keyOnly
                  ? t('messages.empty.keyMessages')
                  : normalizedSearch
                    ? t('messages.empty.noResults')
                    : t('messages.empty.threadEmpty')}
              </div>
            )}
          </section>

          <div className="pc-composer-wrap">
            {notice ? (
              <div className={`pc-confirm-bar ${notice.tone === 'success' ? 'is-success' : ''}`} role="status">
                <span>{notice.text}</span>
                <span className="pc-confirm-actions">
                  {normalizedSearch ? (
                    <button className="pc-chip" onClick={() => setSearchQuery('')} type="button">
                      {t('search.clear')}
                    </button>
                  ) : null}
                  <button className="pc-chip" onClick={() => setNotice(null)} type="button">
                    {t('notice.dismiss')}
                  </button>
                </span>
              </div>
            ) : null}

            {attachmentsOpen ? (
              <div className="pc-attachment-tray pc-glass" aria-label={t('composer.attachmentPanel')}>
                {attachmentOptions.map((attachment) => {
                  const isSelected = selectedAttachmentIds.includes(attachment.id);

                  return (
                    <button
                      className={`pc-attachment ${isSelected ? 'is-active' : ''}`}
                      key={attachment.id}
                      onClick={() => toggleAttachment(attachment.id)}
                      type="button"
                      aria-pressed={isSelected}
                    >
                      <Icon name={attachment.icon} />
                      {attachment.name} - {attachment.detail}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {selectedAttachments.length > 0 ? (
              <div className="pc-selected-attachments" aria-label={t('context.selectedAttachments')}>
                {selectedAttachments.map((attachment) => (
                  <button
                    className="pc-attachment is-active"
                    key={attachment.id}
                    onClick={() => removeAttachment(attachment.id)}
                    type="button"
                    aria-label={t('attachment.remove', { name: attachment.name })}
                  >
                    <Icon name={attachment.icon} />
                    {attachment.name} - {attachment.detail}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="pc-composer pc-glass">
              <div className="pc-composer-tools">
                <button
                  className={`pc-tool-button ${attachmentsOpen ? 'is-active' : ''}`}
                  onClick={toggleAttachmentPanel}
                  disabled={isChatLocked}
                  type="button"
                  aria-label={t('composer.attach')}
                >
                  <Icon name="add" />
                </button>
                <button className="pc-tool-button" disabled={isChatLocked} onClick={insertCodeSnippet} type="button" aria-label={t('composer.insertCode')}>
                  <Icon name="code" />
                </button>
                <button
                  className="pc-tool-button"
                  disabled={isChatLocked || activeConversation.allMessages.length === 0}
                  onClick={quoteLatestMessage}
                  type="button"
                  aria-label={t('composer.quote')}
                >
                  <Icon name="format_quote" />
                </button>
              </div>

              <textarea
                aria-label={t('composer.messageLabel', { name: activeConversation.name })}
                disabled={isChatLocked}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={hasHubSession ? t('composer.readOnlyPlaceholder') : t('composer.lockedPlaceholder')}
                value={draft}
              />

              <div className="pc-composer-actions">
                <button
                  className="pc-tool-button"
                  disabled
                  type="button"
                  aria-label={t('composer.voice')}
                >
                  <Icon name="mic" />
                </button>
                <button className="pc-send-button" disabled={isChatLocked || !hasComposerContent} onClick={sendDraft} type="button">
                  <Icon name="send" />
                  {hasHubSession ? t('composer.readOnlySend') : t('composer.lockedSend')}
                </button>
              </div>
            </div>
          </div>
        </main>

        <aside className="pc-context-panel pc-panel pc-glass">
          <header className="pc-header pc-context-header">
            <div className="pc-title">
              <div className="pc-eyebrow">{t('context.title')}</div>
              <h2>{activeConversation.name}</h2>
              <p>
                {t('context.review', { count: activeConversation.allMessages.length, progress: reviewProgress })}
              </p>
            </div>
            <button
              className="pc-icon-button"
              onClick={() => showNotice(t('notice.contextDetails'))}
              type="button"
              aria-label={t('context.open')}
            >
              <Icon name="open_in_new" />
            </button>
          </header>

          <div className="pc-context-body">
            <section className="pc-mini-card">
              <h3>{t('context.reviewTitle')}</h3>
              <div className="pc-progress"><span style={{ width: `${reviewProgress}%` }} /></div>
              <p style={{ marginTop: 10 }}>
                {t('context.reviewDetail', { keyCount: activeKeyCount, unread: activeConversation.currentUnread })}
              </p>
            </section>

            <section className="pc-mini-card">
              <h3>{t('context.attachments')}</h3>
              {activeAttachments.length > 0 ? (
                <ul>
                  {activeAttachments.map((attachment, index) => (
                    <li key={`${attachment.name}-${index}`}>
                      {attachment.name} - {attachment.detail}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t('context.noAttachments')}</p>
              )}
            </section>

            <section className="pc-mini-card">
              <h3>{t('context.codeSnippets')}</h3>
              {activeCodeBlock ? (
                <div className="pc-code-card">
                  <header>
                    <span>{activeCodeBlock.file}</span>
                    <span>{t('code.local')}</span>
                  </header>
                  <pre>
                    {activeCodeBlock.lines.map((line, index) => (
                      <code key={`${activeCodeBlock.file}-${index}`}>{line}</code>
                    ))}
                  </pre>
                </div>
              ) : (
                <p>{t('context.noSnippets')}</p>
              )}
            </section>

            <section className="pc-mini-card">
              <h3>{t('context.tags')}</h3>
              <div className="pc-chip-row">
                <span className="pc-chip">chat: {activeConversation.name}</span>
                <span className="pc-chip">attachments: {attachmentsOpen ? 'open' : 'closed'}</span>
                <span className="pc-chip">filter: {keyOnly ? 'keyed' : 'all'}</span>
                <span className="pc-chip">search: {normalizedSearch || 'none'}</span>
                <span className="pc-chip">selected: {selectedAttachments.length}</span>
              </div>
            </section>
          </div>
        </aside>
      </div>
=======
    playMessageStream(stream, { messageId: `stream-${activeChatId}`, threadId: activeChatId, chunkDelayMs: 80 });
    return () => { stream.destroy(); unsub(); };
  }, [activeChatId]);

  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 3200); return () => window.clearTimeout(t); }, [notice]);

  const showNotice = (text: string, tone: Notice['tone'] = 'info') => { setNotice({ id: Date.now(), text, tone }); };

  const selectConversation = (chatId: string) => {
    const next = conversationSnapshots.find((c) => c.id === chatId);
    setActiveChatId(chatId);
    setUnreadByChat((prev) => ({ ...prev, [chatId]: 0 }));
    if (next?.currentUnread) showNotice(`${next.name} marked as read`, 'success');
  };

  const toggleAttachment = (id: string) => {
    const att = attachmentOptions.find((a) => a.id === id);
    const isSel = selectedAttachmentIds.includes(id);
    setSelectedAttachmentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    if (att) showNotice(`${isSel ? 'Removed' : 'Selected'} ${att.name}`);
  };

  const removeAttachment = (id: string) => {
    const att = attachmentOptions.find((a) => a.id === id);
    setSelectedAttachmentIds((prev) => prev.filter((x) => x !== id));
    showNotice(`${att?.name ?? 'Attachment'} removed`);
  };

  const toggleKeyedMessage = (msgId: string) => {
    const msg = activeConv.allMessages.find((m) => m.id === msgId);
    const isKeyed = keyedMessages.includes(msgId);
    setKeyedMessages((prev) => prev.includes(msgId) ? prev.filter((x) => x !== msgId) : [...prev, msgId]);
    showNotice(`${isKeyed ? 'Removed from' : 'Marked as'} key: ${msg?.author ?? 'message'}`, isKeyed ? 'info' : 'success');
  };

  const insertCodeSnippet = () => {
    setDraft((prev) => `${prev}${prev ? '\n\n' : ''}\`\`\`tsx\n// paste selected snippet here\n\`\`\``);
    showNotice('Code block inserted into the local draft');
  };

  const quoteLatestMessage = () => {
    const src = [...activeConv.allMessages].reverse().find((m) => keyedMessages.includes(m.id)) ?? activeConv.allMessages[activeConv.allMessages.length - 1];
    if (!src) return;
    setDraft((prev) => `${prev}${prev ? '\n\n' : ''}> ${src.body.slice(0, 120)}`);
    showNotice(`Quoted ${src.author}'s latest context`);
  };

  const sendDraft = () => {
    if (!hasComposerContent) { showNotice(t('pc.notice.sendEmpty')); return; }
    const msgAtts = selectedAttachments.map(({ name, detail }) => ({ name, detail }));
    const msg: Message = {
      id: `local-${activeConv.id}-${Date.now()}`, author: 'You', role: 'Local draft',
      time: formatClock(), side: 'right', body: draft.trim() || 'Attached selected context for review.',
      isDraft: true,
      ...(msgAtts.length > 0 ? { attachments: msgAtts } : {}),
    };
    setLocalMessages((prev) => ({ ...prev, [activeConv.id]: [...(prev[activeConv.id] ?? []), msg] }));
    setUnreadByChat((prev) => ({ ...prev, [activeConv.id]: 0 }));
    setSelectedAttachmentIds([]); setAttachmentsOpen(false); setDraft('');
    showNotice(t('pc.notice.sent'), 'success');
  };

  const sidebarBottom = (
    <div className={styles.convList}>
      {filteredConversations.length > 0 ? filteredConversations.map((c) => (
        <button className={`${styles.convCard} ${c.id === activeConv.id ? styles.convCardActive : ''}`} key={c.id} onClick={() => selectConversation(c.id)} type="button">
          <div className={`${styles.msgAvatar} ${accentClass(c.accent)}`}>{c.initials}</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.convCardName}>{c.name}</div>
            <div className={styles.convCardSummary}>{c.currentSummary}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span className={styles.convTime}>{c.currentTime}</span>
            {c.currentUnread > 0 ? <span className={styles.convUnread}>{c.currentUnread}</span> : null}
          </div>
        </button>
      )) : <div className={styles.emptyState}>{t('pc.noChats')}</div>}
    </div>
  );

  return (
    <div className={styles.pageRoot}>
      <ParticleCanvas />
      <WebLayout
        brandName={t('pc.brand')}
        brandSubtitle={t('pc.subtitle')}
        sidebarBottom={(
          <>
            <div className={styles.searchWrap}>
              <SearchInput placeholder={t('pc.search')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            {normalizedSearch ? <div className={styles.filterNote}>{t('pc.filterNote', { chatCount: filteredConversations.length, msgCount: messages.length, query: searchQuery.trim() })}</div> : null}
            <div style={{ padding: '10px 16px 8px', color: 'var(--muted-foreground)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('pc.pinned')}</div>
            {sidebarBottom}
          </>
        )}
        topbarLeft={null}
        topbarRight={null}
        drawer={(
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--muted-foreground)', marginBottom: 4 }}>{t('pc.context.title')}</div>
                <h2 style={{ margin: 0, fontSize: 15, color: 'var(--foreground)' }}>{activeConv.name}</h2>
                <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>{t('pc.context.messages', { count: activeConv.allMessages.length })} - {t('pc.context.reviewed', { percent: reviewProgress })}</p>
              </div>
              <Button variant="icon" onClick={() => showNotice('Context details stay in this local preview')} aria-label="Open context"><Icon name="open_in_new" /></Button>
            </div>
            <div className={styles.contextBody}>
              <div className={styles.miniCard}>
                <h3>{t('pc.context.reviewProgress')}</h3>
                <div className={styles.progress}><span className={styles.progressFill} style={{ width: `${reviewProgress}%` }} /></div>
                <p style={{ marginTop: 10 }}>{t('pc.context.progressDetail', { keyed: activeKeyCount, unread: activeConv.currentUnread, drafts: localMessages[activeConv.id]?.length ?? 0 })}</p>
              </div>
              <div className={styles.miniCard}>
                <h3>{t('pc.attachments')}</h3>
                {activeAttachments.length > 0 ? (
                  <ul>{activeAttachments.map((a, i) => <li key={`${a.name}-${i}`}>{a.name} - {a.detail}</li>)}</ul>
                ) : <p>{t('pc.context.noAttachments')}</p>}
              </div>
              <div className={styles.miniCard}>
                <h3>{t('pc.context.codeSnippets')}</h3>
                {activeCodeBlock ? (
                  <div className={styles.codeCard}>
                    <div className={styles.codeCardHeader}><span>{activeCodeBlock.file}</span><span>{t('pc.context.snippet')}</span></div>
                    <pre className={styles.codeCardPre}>{activeCodeBlock.lines.map((line, i) => <code key={`ctx-${i}`} style={{ display: 'block', whiteSpace: 'pre' }}>{line}</code>)}</pre>
                  </div>
                ) : <p>{t('pc.context.noCode')}</p>}
              </div>
              <div className={styles.miniCard}>
                <h3>{t('pc.context.visibleState')}</h3>
                <div className={styles.chipRow}>
                  <span className={styles.chip}>{t('pc.context.chat')}: {activeConv.name}</span>
                  <span className={styles.chip}>{t('pc.context.attachmentsState')}: {attachmentsOpen ? 'open' : 'closed'}</span>
                  <span className={styles.chip}>{t('pc.context.filter')}: {keyOnly ? 'keyed' : 'all'}</span>
                  <span className={styles.chip}>{t('pc.context.search')}: {normalizedSearch || 'none'}</span>
                  <span className={styles.chip}>{t('pc.context.selected')}: {selectedAttachments.length}</span>
                </div>
              </div>
            </div>
          </>
        )}
      >
        {/* Chat header */}
        <div className={styles.chatHeader}>
          <div className={styles.chatHeaderMain}>
            <div className={`${styles.msgAvatar} ${accentClass(activeConv.accent)}`}>{activeConv.initials}</div>
            <div style={{ minWidth: 0 }}>
              <div className={styles.headerName}>{activeConv.name}</div>
              <div className={styles.headerRole}>{activeConv.role} - private thread</div>
            </div>
            <span className={styles.onlineBadge}><span className={styles.onlineDot} />{t('pc.status.online')}</span>
          </div>
          <div className={styles.headerActions}>
            <Button variant={keyOnly ? 'primary' : 'icon'} size="sm" disabled={activeConv.allMessages.length === 0} onClick={() => setKeyOnly((v) => !v)} aria-pressed={keyOnly} aria-label="Show key messages only"><Icon name="star" /></Button>
            <Button variant={attachmentsOpen ? 'primary' : 'icon'} size="sm" onClick={() => setAttachmentsOpen((v) => !v)} aria-expanded={attachmentsOpen} aria-label="Open attachments"><Icon name="attach_file" /></Button>
            <Button variant="icon" size="sm" onClick={() => showNotice('More actions are local-preview only')} aria-label="More actions"><Icon name="more_horiz" /></Button>
          </div>
        </div>

        {/* Messages */}
        <div className={styles.messages} aria-label="Message thread">
          {messages.length > 0 ? messages.map((msg) => {
            const isKeyed = keyedMessages.includes(msg.id);
            return (
              <article className={`${styles.msgRow} ${msg.side === 'right' ? styles.msgRowMine : ''}`} key={msg.id}>
                <div className={`${styles.msgAvatar} ${msg.side === 'right' ? styles.msgAvatarMine : accentClass(msg.accent ?? activeConv.accent)}`}>
                  {msg.side === 'right' ? 'ME' : activeConv.initials}
                </div>
                <div className={styles.msgStack}>
                  <div className={styles.msgMeta}>
                    <strong className={styles.msgMetaAuthor}>{msg.author}</strong>
                    <span>{msg.time}</span>
                    <span>{msg.role}</span>
                    <button className={`${styles.keyBtn} ${isKeyed ? styles.keyBtnActive : ''}`} onClick={() => toggleKeyedMessage(msg.id)} type="button" aria-pressed={isKeyed}>
                      {isKeyed ? t('pc.key.keyed') : t('pc.key.mark')}
                    </button>
                  </div>
                  <div className={`${styles.msgBubble} ${msg.side === 'right' ? styles.msgBubbleMine : ''} ${msg.isDraft ? styles.msgBubbleDraft : ''}`}>
                    {msg.quote ? <div className={styles.quote}><strong>{msg.quote.title}</strong><br />{msg.quote.body}</div> : null}
                    {msg.body}
                    {msg.attachments ? <div className={styles.attachmentList}>{msg.attachments.map((a) => <span className={styles.attachment} key={`${msg.id}-${a.name}`}><Icon name="description" size={16} />{a.name} - {a.detail}</span>)}</div> : null}
                    {msg.code ? (
                      <div className={styles.codeCard}>
                        <div className={styles.codeCardHeader}><span>{msg.code.file}</span><span>{t('pc.context.snippet')}</span></div>
                        <pre className={styles.codeCardPre}>{msg.code.lines.map((line, i) => <code key={`${msg.id}-ln-${i}`} style={{ display: 'block', whiteSpace: 'pre' }}>{line}</code>)}</pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          }) : (
            <div className={styles.emptyState}>
              {keyOnly ? t('pc.noKeyMessages') : normalizedSearch ? t('pc.noSearchMessages') : t('pc.emptyThread')}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className={styles.composerWrap}>
          {notice ? <div className={`${styles.noticeBar} ${notice.tone === 'success' ? styles.noticeSuccess : ''}`} role="status"><span>{notice.text}</span><span className={styles.noticeActions}>{normalizedSearch ? <button className={styles.chip} onClick={() => setSearchQuery('')}>{t('pc.notice.clearSearch')}</button> : null}<button className={styles.chip} onClick={() => setNotice(null)}>{t('pc.notice.dismiss')}</button></span></div> : null}

          {attachmentsOpen ? (
            <div className={styles.attachmentTray} aria-label="Attachment panel">
              {attachmentOptions.map((a) => { const isSel = selectedAttachmentIds.includes(a.id);
                return <button className={`${styles.attachment} ${styles.attachmentBtn} ${isSel ? styles.attachmentActive : ''}`} key={a.id} onClick={() => toggleAttachment(a.id)} type="button" aria-pressed={isSel}><Icon name={a.icon} size={16} />{a.name} - {a.detail}</button>;
              })}
            </div>
          ) : null}

          {selectedAttachments.length > 0 ? (
            <div className={styles.selectedAttachments} aria-label="Selected attachments">
              {selectedAttachments.map((a) => <button className={`${styles.attachment} ${styles.attachmentBtn} ${styles.attachmentActive}`} key={a.id} onClick={() => removeAttachment(a.id)} type="button" aria-label={`Remove ${a.name}`}><Icon name={a.icon} size={16} />{a.name} - {a.detail}</button>)}
            </div>
          ) : null}

          <div className={styles.composer}>
            <div className={styles.composerTools}>
              <Button variant={attachmentsOpen ? 'primary' : 'icon'} size="sm" onClick={() => setAttachmentsOpen((v) => !v)} aria-label="Toggle attachment panel"><Icon name="add" /></Button>
              <Button variant="icon" size="sm" onClick={insertCodeSnippet} aria-label="Insert code"><Icon name="code" /></Button>
              <Button variant="icon" size="sm" disabled={activeConv.allMessages.length === 0} onClick={quoteLatestMessage} aria-label="Quote selected message"><Icon name="format_quote" /></Button>
            </div>
            <textarea className={styles.composerTextarea} aria-label={`Message ${activeConv.name}`} onChange={(e) => setDraft(e.target.value)} placeholder={t('pc.composer.placeholder')} value={draft} />
            <div className={styles.composerActions}>
              <Button variant="icon" size="sm" disabled aria-label="Voice note unavailable"><Icon name="mic" /></Button>
              <button className={styles.sendBtn} disabled={!hasComposerContent} onClick={sendDraft} type="button"><Icon name="send" />{t('pc.send')}</button>
            </div>
          </div>
        </div>
      </WebLayout>
>>>>>>> origin/dev/delicious233
    </div>
  );
}

<<<<<<< HEAD
export default PrivateChatsPageInteractive;
=======
export default PrivateChatsPage;
>>>>>>> origin/dev/delicious233
