import { useEffect, useMemo, useRef, useState } from 'react';
import { mockThreads, mockMessages, MockEventStream, playMessageStream } from '@shared/index';

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

const conversations: Conversation[] = mockThreads.map((thread, ti) => {
  const threadMessages = mockMessages.filter((m) => m.threadId === thread.id);
  const accentOptions: Accent[] = ['blue', 'cyan', 'purple'];
  return {
    id: thread.id,
    name: thread.title ?? `Thread ${thread.id}`,
    initials: (thread.title ?? 'T').slice(0, 2).toUpperCase(),
    role: thread.projectId,
    time: '10:42',
    summary: thread.status === 'active' ? 'Active conversation' : 'Archived',
    unread: ti === 0 ? 2 : ti === 1 ? 0 : 1,
    accent: accentOptions[ti % accentOptions.length],
    messages: threadMessages.map((msg) => ({
      id: msg.id,
      author: msg.role === 'user' ? 'You' : 'Agent',
      role: msg.role === 'user' ? 'Owner' : 'Agent',
      time: '10:30',
      side: (msg.role === 'user' ? 'right' : 'left') as 'left' | 'right',
      body: msg.content,
      ...(msg.role === 'agent' ? { accent: accentOptions[ti % accentOptions.length] } : {}),
    })),
  };
});

const attachmentOptions: AttachmentOption[] = [
  { id: 'local-context', name: 'local-context.md', detail: 'queued', icon: 'description' },
  { id: 'selection-snippet', name: 'selection.tsx', detail: 'snippet', icon: 'code' },
  { id: 'handoff-checklist', name: 'handoff checklist', detail: 'note', icon: 'tag' },
];

const initialUnreadByChat = conversations.reduce<Record<string, number>>((unreadMap, conversation) => {
  unreadMap[conversation.id] = conversation.unread;
  return unreadMap;
}, {});

function formatClock(date = new Date()) {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');

  return `${hours}:${minutes}`;
}

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

const pageStyles = `
  @import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap");
  @import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0,0");

  .pc-page {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.16), transparent 28%),
      radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.14), transparent 30%),
      linear-gradient(135deg, #f7fbff, #edf6ff);
    color: #172033;
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
    min-height: 100vh;
    padding: 18px;
  }

  .pc-glass {
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
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
    border-bottom: 1px solid rgba(134, 157, 190, 0.24);
  }

  .pc-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  }

  .pc-brand-mark {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    color: #fff;
    font-weight: 900;
    border-radius: 10px;
    background: linear-gradient(135deg, #1769e8, #08a7cf);
    box-shadow: 0 10px 22px rgba(23, 105, 232, 0.24);
  }
  .pc-chat-header,
  .pc-context-header {
    justify-content: space-between;
  }

  .pc-title h1,
  .pc-title h2 {
    margin: 0;
    color: #172033;
    font-size: 15px;
    line-height: 1.25;
  }

  .pc-brand h2 {
    margin: 0;
    color: #172033;
    font-size: 15px;
    line-height: 1.25;
  }

  .pc-title .pc-brand-sub {
    margin: 4px 0 0;
    color: #667085;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
  }

  .pc-eyebrow,
  .pc-section-title,
  .pc-meta {
    margin: 0 0 4px;
    color: #667085;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .pc-title .pc-brand-sub {
    margin: 0;
    color: #667085;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    line-height: normal;
  }

  .pc-icon-button,
  .pc-tool-button,
  .pc-send-button,
  .pc-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(132, 155, 190, 0.24);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.62);
    color: #172033;
    box-shadow: 0 8px 20px rgba(31, 57, 102, 0.08);
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
    border-color: rgba(37, 99, 235, 0.34);
    background: rgba(37, 99, 235, 0.1);
    color: #2563eb;
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
    color: #7b8aa4;
    font-size: 18px;
  }

  .pc-search input {
    width: 100%;
    height: 36px;
    border: 1px solid rgba(132, 155, 190, 0.24);
    border-radius: 8px;
    outline: 0;
    padding: 0 12px 0 34px;
    background: rgba(255, 255, 255, 0.68);
    color: #172033;
  }

  .pc-filter-note {
    padding: 0 16px 8px;
    color: #667085;
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
    border: 1px solid transparent;
    border-radius: 12px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.45);
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .pc-chat-card.is-active {
    border-color: rgba(37, 99, 235, 0.28);
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
    background: linear-gradient(135deg, #2563eb, #0891b2);
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    box-shadow: 0 10px 22px rgba(37, 99, 235, 0.24);
  }

  .pc-avatar.cyan {
    background: linear-gradient(135deg, #0891b2, #22c55e);
  }

  .pc-avatar.purple {
    background: linear-gradient(135deg, #7c3aed, #0ea5e9);
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
    color: #667085;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pc-time {
    color: #7f8aa3;
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
    background: #2563eb;
    color: #fff;
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
    background: rgba(5, 150, 105, 0.1);
    color: #059669;
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
    background: linear-gradient(135deg, #1d4ed8, #7c3aed);
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
    color: #667085;
    font-size: 11px;
  }

  .pc-message-row.is-mine .pc-message-meta {
    justify-content: flex-end;
  }

  .pc-key-button {
    border: 0;
    border-radius: 7px;
    padding: 3px 7px;
    background: rgba(124, 58, 237, 0.1);
    color: #6d28d9;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
  }

  .pc-key-button.is-active {
    background: rgba(124, 58, 237, 0.18);
    color: #4c1d95;
  }

  .pc-confirm-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    border: 1px solid rgba(37, 99, 235, 0.22);
    border-radius: 10px;
    padding: 9px 10px;
    background: rgba(255, 255, 255, 0.66);
    color: #344055;
    font-size: 12px;
  }

  .pc-confirm-bar.is-success {
    border-color: rgba(5, 150, 105, 0.24);
    background: rgba(5, 150, 105, 0.08);
    color: #047857;
  }

  .pc-confirm-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .pc-bubble {
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 12px;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.74);
    box-shadow: 0 10px 26px rgba(31, 57, 102, 0.09);
    color: #22304a;
    font-size: 14px;
    line-height: 1.5;
  }

  .pc-message-row.is-mine .pc-bubble {
    border-color: rgba(37, 99, 235, 0.36);
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.92), rgba(8, 145, 178, 0.9));
    color: #fff;
  }

  .pc-bubble.is-draft {
    border-style: dashed;
  }

  .pc-quote {
    margin-bottom: 10px;
    border-left: 3px solid #0891b2;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(8, 145, 178, 0.08);
    color: #345064;
  }

  .pc-code-card {
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid rgba(23, 32, 51, 0.1);
    border-radius: 10px;
    background: #111827;
    color: #d7e5ff;
  }

  .pc-code-card header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 34px;
    padding: 0 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    color: #9fb4d8;
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
    border: 1px solid rgba(132, 155, 190, 0.24);
    border-radius: 8px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.68);
    color: #344055;
    font: inherit;
    font-size: 12px;
  }

  button.pc-attachment {
    cursor: pointer;
  }

  .pc-attachment.is-active {
    border-color: rgba(37, 99, 235, 0.34);
    background: rgba(37, 99, 235, 0.1);
    color: #1d4ed8;
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
    border: 1px solid rgba(132, 155, 190, 0.2);
    border-radius: 10px;
    outline: 0;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.64);
    color: #172033;
    line-height: 1.45;
  }

  .pc-send-button {
    height: 36px;
    gap: 8px;
    padding: 0 14px;
    border-color: rgba(37, 99, 235, 0.34);
    background: linear-gradient(135deg, #2563eb, #0891b2);
    color: #fff;
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
    border: 1px solid rgba(132, 155, 190, 0.22);
    border-radius: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.55);
  }

  .pc-mini-card h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }

  .pc-mini-card p,
  .pc-mini-card li {
    color: #667085;
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
    min-height: 28px;
    padding: 0 9px;
    color: #40516f;
    font-size: 12px;
    box-shadow: none;
  }

  .pc-progress {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.1);
  }

  .pc-progress span {
    display: block;
    width: 68%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #2563eb, #0891b2, #7c3aed);
  }

  .pc-empty {
    align-self: center;
    border-radius: 12px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.55);
    color: #667085;
    font-size: 13px;
  }

  @media (max-width: 1120px) {
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

  @media (max-width: 760px) {
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
  const [activeChatId, setActiveChatId] = useState(conversations[0].id);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [keyOnly, setKeyOnly] = useState(false);
  const [keyedMessages, setKeyedMessages] = useState<string[]>(mockMessages.slice(0, 1).map((m) => m.id));
  const [draft, setDraft] = useState('');
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>({});
  const [unreadByChat, setUnreadByChat] = useState<Record<string, number>>(initialUnreadByChat);
  const [searchQuery, setSearchQuery] = useState('routing handoff');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const conversationSnapshots = useMemo<ConversationSnapshot[]>(
    () =>
      conversations.map((conversation) => {
        const allMessages = [
          ...conversation.messages,
          ...(localMessages[conversation.id] ?? []),
        ];
        const lastMessage = allMessages[allMessages.length - 1];

        return {
          ...conversation,
          allMessages,
          currentSummary: lastMessage ? getLastMessageSummary(lastMessage) : conversation.summary,
          currentTime: lastMessage?.time ?? conversation.time,
          currentUnread: unreadByChat[conversation.id] ?? 0,
        };
      }),
    [localMessages, unreadByChat],
  );

  const activeConversation = useMemo(
    () => conversationSnapshots.find((conversation) => conversation.id === activeChatId) ?? conversationSnapshots[0],
    [activeChatId, conversationSnapshots],
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
    Math.round(((activeKeyCount + selectedAttachments.length + (localMessages[activeConversation.id]?.length ?? 0)) /
      Math.max(activeConversation.allMessages.length + 2, 1)) * 100),
  );

  const hasComposerContent = draft.trim().length > 0 || selectedAttachments.length > 0;

  // Mock message stream — simulates streaming agent responses.
  useEffect(() => {
    const stream = new MockEventStream();
    const activeConv = conversations.find((c) => c.id === activeChatId);
    if (!activeConv) return;
    const unsub = stream.onType('message.delta', (event) => {
      if (event.type === 'message.delta') {
        const delta = String(event.payload.delta ?? '');
        const msgId = String(event.payload.messageId ?? '');
        setLocalMessages((prev) => {
          const existing = prev[msgId] ?? [];
          const last = existing[existing.length - 1];
          if (last && last.isDraft) {
            return {
              ...prev,
              [msgId]: [
                ...existing.slice(0, -1),
                { ...last, body: last.body + delta },
              ],
            };
          }
          const draftMsg: Message = {
            id: msgId,
            author: 'Agent',
            role: 'Agent',
            time: formatClock(),
            side: 'left',
            accent: activeConv.accent,
            body: delta,
            isDraft: true,
          };
          return { ...prev, [msgId]: [...existing, draftMsg] };
        });
      }
    });
    playMessageStream(stream, {
      messageId: `stream-${activeChatId}`,
      threadId: activeChatId,
      chunkDelayMs: 80,
    });
    return () => { stream.destroy(); unsub(); };
  }, [activeChatId]);

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
    setUnreadByChat((current) => ({ ...current, [chatId]: 0 }));

    if (nextConversation?.currentUnread) {
      showNotice(`${nextConversation.name} marked as read`, 'success');
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
      showNotice(`${isSelected ? 'Removed' : 'Selected'} ${attachment.name}`);
    }
  };

  const removeAttachment = (attachmentId: string) => {
    const attachment = attachmentOptions.find((option) => option.id === attachmentId);

    setSelectedAttachmentIds((current) =>
      current.filter((currentAttachmentId) => currentAttachmentId !== attachmentId),
    );
    showNotice(`${attachment?.name ?? 'Attachment'} removed`);
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
      `${isKeyed ? 'Removed from' : 'Marked as'} key: ${message?.author ?? 'message'}`,
      isKeyed ? 'info' : 'success',
    );
  };

  const insertCodeSnippet = () => {
    setDraft((current) => `${current}${current ? '\n\n' : ''}\`\`\`tsx\n// paste selected snippet here\n\`\`\``);
    showNotice('Code block inserted into the local draft');
  };

  const quoteLatestMessage = () => {
    const source =
      [...activeConversation.allMessages].reverse().find((message) => keyedMessages.includes(message.id)) ??
      activeConversation.allMessages[activeConversation.allMessages.length - 1];

    if (!source) {
      return;
    }

    setDraft((current) => `${current}${current ? '\n\n' : ''}> ${source.body.slice(0, 120)}`);
    showNotice(`Quoted ${source.author}'s latest context`);
  };

  const sendDraft = () => {
    const text = draft.trim();

    if (!hasComposerContent) {
      showNotice('Write a message or select an attachment before sending');
      return;
    }

    const selectedMessageAttachments = selectedAttachments.map(({ name, detail }) => ({ name, detail }));

    const message: Message = {
      id: `local-${activeConversation.id}-${Date.now()}`,
      author: 'You',
      role: 'Local draft',
      time: formatClock(),
      side: 'right',
      body: text || 'Attached selected context for review.',
      isDraft: true,
      attachments: selectedMessageAttachments.length > 0 ? selectedMessageAttachments : undefined,
    };

    setLocalMessages((current) => ({
      ...current,
      [activeConversation.id]: [...(current[activeConversation.id] ?? []), message],
    }));
    setUnreadByChat((current) => ({ ...current, [activeConversation.id]: 0 }));
    setSelectedAttachmentIds([]);
    setAttachmentsOpen(false);
    setDraft('');
    showNotice('Local draft appended to this private thread', 'success');
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
              <p className="pc-brand-sub">Private Chats</p>
            </div>
          </div>

          <div className="pc-search">
            <Icon name="search" />
            <input
              aria-label="Search private chats"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search people, handoffs, snippets..."
              type="search"
              value={searchQuery}
            />
          </div>

          <div className="pc-section-title">Pinned Threads</div>
          {normalizedSearch ? (
            <div className="pc-filter-note">
              {filteredConversations.length} chats and {messages.length} messages match "{searchQuery.trim()}"
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
              <div className="pc-empty">No private chats match this search.</div>
            )}
          </div>
        </aside>

        <main className="pc-chat-panel pc-panel pc-glass">
          <header className="pc-header pc-chat-header">
            <div className="pc-chat-heading">
              <Avatar initials={activeConversation.initials} accent={activeConversation.accent} />
              <div className="pc-title">
                <h2>{activeConversation.name}</h2>
                <p>{activeConversation.role} - private thread</p>
              </div>
              <span className="pc-status">Online</span>
            </div>

            <div className="pc-actions">
              <button
                className={`pc-icon-button ${keyOnly ? 'is-active' : ''}`}
                disabled={activeConversation.allMessages.length === 0}
                onClick={() => setKeyOnly((current) => !current)}
                type="button"
                aria-pressed={keyOnly}
                aria-label="Show key messages only"
              >
                <Icon name="star" />
              </button>
              <button
                className={`pc-icon-button ${attachmentsOpen ? 'is-active' : ''}`}
                onClick={toggleAttachmentPanel}
                type="button"
                aria-expanded={attachmentsOpen}
                aria-label="Open attachments"
              >
                <Icon name="attach_file" />
              </button>
              <button
                className="pc-icon-button"
                onClick={() => showNotice('More actions are local-preview only')}
                type="button"
                aria-label="More actions"
              >
                <Icon name="more_horiz" />
              </button>
            </div>
          </header>

          <section className="pc-messages" aria-label="Message thread">
            {messages.length > 0 ? (
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
                          {isKeyed ? 'Keyed' : 'Mark key'}
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
                              <span>snippet</span>
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
                  ? 'No key messages match the current view.'
                  : normalizedSearch
                    ? 'No messages match this search in the selected conversation.'
                    : 'This private thread is empty.'}
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
                      Clear search
                    </button>
                  ) : null}
                  <button className="pc-chip" onClick={() => setNotice(null)} type="button">
                    Dismiss
                  </button>
                </span>
              </div>
            ) : null}

            {attachmentsOpen ? (
              <div className="pc-attachment-tray pc-glass" aria-label="Attachment panel">
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
              <div className="pc-selected-attachments" aria-label="Selected attachments">
                {selectedAttachments.map((attachment) => (
                  <button
                    className="pc-attachment is-active"
                    key={attachment.id}
                    onClick={() => removeAttachment(attachment.id)}
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
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
                  type="button"
                  aria-label="Toggle attachment panel"
                >
                  <Icon name="add" />
                </button>
                <button className="pc-tool-button" onClick={insertCodeSnippet} type="button" aria-label="Insert code">
                  <Icon name="code" />
                </button>
                <button
                  className="pc-tool-button"
                  disabled={activeConversation.allMessages.length === 0}
                  onClick={quoteLatestMessage}
                  type="button"
                  aria-label="Quote selected message"
                >
                  <Icon name="format_quote" />
                </button>
              </div>

              <textarea
                aria-label={`Message ${activeConversation.name}`}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a private note, paste a code fragment, or attach handoff context..."
                value={draft}
              />

              <div className="pc-composer-actions">
                <button
                  className="pc-tool-button"
                  disabled
                  type="button"
                  aria-label="Voice note unavailable in local preview"
                >
                  <Icon name="mic" />
                </button>
                <button className="pc-send-button" disabled={!hasComposerContent} onClick={sendDraft} type="button">
                  <Icon name="send" />
                  Send
                </button>
              </div>
            </div>
          </div>
        </main>

        <aside className="pc-context-panel pc-panel pc-glass">
          <header className="pc-header pc-context-header">
            <div className="pc-title">
              <div className="pc-eyebrow">Thread Context</div>
              <h2>{activeConversation.name}</h2>
              <p>
                {activeConversation.allMessages.length} messages - {reviewProgress}% reviewed
              </p>
            </div>
            <button
              className="pc-icon-button"
              onClick={() => showNotice('Context details stay in this local preview')}
              type="button"
              aria-label="Open context"
            >
              <Icon name="open_in_new" />
            </button>
          </header>

          <div className="pc-context-body">
            <section className="pc-mini-card">
              <h3>Review Progress</h3>
              <div className="pc-progress"><span style={{ width: `${reviewProgress}%` }} /></div>
              <p style={{ marginTop: 10 }}>
                {activeKeyCount} key messages, {activeConversation.currentUnread} unread, and{' '}
                {localMessages[activeConversation.id]?.length ?? 0} local drafts in this thread.
              </p>
            </section>

            <section className="pc-mini-card">
              <h3>Attachments</h3>
              {activeAttachments.length > 0 ? (
                <ul>
                  {activeAttachments.map((attachment, index) => (
                    <li key={`${attachment.name}-${index}`}>
                      {attachment.name} - {attachment.detail}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No linked attachments for this conversation yet.</p>
              )}
            </section>

            <section className="pc-mini-card">
              <h3>Code Snippets</h3>
              {activeCodeBlock ? (
                <div className="pc-code-card">
                  <header>
                    <span>{activeCodeBlock.file}</span>
                    <span>local</span>
                  </header>
                  <pre>
                    {activeCodeBlock.lines.map((line, index) => (
                      <code key={`${activeCodeBlock.file}-${index}`}>{line}</code>
                    ))}
                  </pre>
                </div>
              ) : (
                <p>No code snippets are linked to this private chat.</p>
              )}
            </section>

            <section className="pc-mini-card">
              <h3>Visible State</h3>
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
    </div>
  );
}

export default PrivateChatsPageInteractive;
