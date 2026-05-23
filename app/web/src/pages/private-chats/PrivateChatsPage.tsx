import { useState, useMemo } from "react";
import {
  Search, ArrowLeft, Star, Paperclip, MoreHorizontal,
  FileText, Code, Quote, Mic, Send, Plus, Tag,
  ExternalLink,
} from "lucide-react";
import styles from "./PrivateChatsPage.module.css";

/* ---- Types ---------------------------------------------- */
type Accent = "blue" | "cyan" | "purple";

interface Attachment {
  name: string;
  detail: string;
}

interface CodeBlock {
  file: string;
  lines: string[];
}

interface QuoteBlock {
  title: string;
  body: string;
}

interface Message {
  id: string;
  author: string;
  role: string;
  time: string;
  side: "left" | "right";
  body: string;
  accent?: Accent;
  attachments?: Attachment[];
  code?: CodeBlock;
  quote?: QuoteBlock;
  isDraft?: boolean;
}

interface Conversation {
  id: string;
  name: string;
  initials: string;
  role: string;
  time: string;
  summary: string;
  unread: number;
  accent: Accent;
  messages: Message[];
}

interface AttachmentOption extends Attachment {
  id: string;
  icon: "file-text" | "code" | "tag";
}

interface ConversationSnapshot extends Conversation {
  allMessages: Message[];
  currentSummary: string;
  currentTime: string;
  currentUnread: number;
}

interface Notice {
  id: number;
  text: string;
  tone: "info" | "success";
}

/* ---- Mock Data ------------------------------------------ */
const conversations: Conversation[] = [
  {
    id: "mira",
    name: "Mira Chen",
    initials: "MC",
    role: "Frontend page coordinator",
    time: "10:42",
    summary: "Route map, guard states, and handoff notes",
    unread: 3,
    accent: "blue",
    messages: [
      {
        id: "mira-1",
        author: "You",
        role: "Owner",
        time: "10:24",
        side: "right",
        body: "Can you sanity-check the private chat layout before I hand it to the page preview branch?",
      },
      {
        id: "mira-2",
        author: "Mira Chen",
        role: "Coordinator",
        time: "10:26",
        side: "left",
        accent: "blue",
        body: "The main issue is density. Keep the left rail focused on people, unread state, and current handoff context.",
        quote: {
          title: "Quoted decision",
          body: "Keep this page as a direct-chat work surface. Route previews and real API wiring can come later.",
        },
      },
      {
        id: "mira-3",
        author: "Mira Chen",
        role: "Coordinator",
        time: "10:31",
        side: "left",
        accent: "blue",
        body: "I tightened the action buttons so icons sit on a fixed grid and never drift into the message title.",
        attachments: [
          { name: "handoff-notes.md", detail: "12 KB" },
          { name: "message-layout.png", detail: "Preview" },
        ],
      },
      {
        id: "mira-4",
        author: "You",
        role: "Owner",
        time: "10:38",
        side: "right",
        body: "Good. I am keeping the iframe preview static and adding a React copy for stateful interactions.",
        code: {
          file: "PrivateChatsPageReact.tsx",
          lines: [
            `const [activeChatId, setActiveChatId] = useState("mira");`,
            `const [attachmentsOpen, setAttachmentsOpen] = useState(false);`,
            `const [keyedMessages, setKeyedMessages] = useState(["mira-2"]);`,
          ],
        },
      },
    ],
  },
  {
    id: "devon",
    name: "Devon Xu",
    initials: "DX",
    role: "Diff reviewer",
    time: "09:58",
    summary: "Diff preview is ready for another pass",
    unread: 0,
    accent: "purple",
    messages: [
      {
        id: "devon-1",
        author: "Devon Xu",
        role: "Reviewer",
        time: "09:49",
        side: "left",
        accent: "purple",
        body: "The preview diff now keeps file headers sticky and line gutters aligned. I attached the snippet for the sidebar tabs.",
        code: {
          file: "diff-tabs.tsx",
          lines: [
            `const tabs = ["Files", "Diff", "Preview", "Logs"];`,
            `const activeTab = tabs.find((tab) => tab === selectedTab);`,
          ],
        },
      },
      {
        id: "devon-2",
        author: "You",
        role: "Owner",
        time: "09:58",
        side: "right",
        body: "Looks good. I will keep this private chat page visually aligned with those tighter tab controls.",
      },
    ],
  },
  {
    id: "aria",
    name: "Aria Lin",
    initials: "AL",
    role: "Client worker",
    time: "09:31",
    summary: "Client runner smoke test notes attached",
    unread: 1,
    accent: "cyan",
    messages: [
      {
        id: "aria-1",
        author: "Aria Lin",
        role: "Client worker",
        time: "09:12",
        side: "left",
        accent: "cyan",
        body: "Runner smoke test notes are attached. No API dependency is needed for the page preview pass.",
        attachments: [
          { name: "runner-smoke.md", detail: "5 checks" },
          { name: "edge-local.log", detail: "redacted" },
        ],
      },
      {
        id: "aria-2",
        author: "You",
        role: "Owner",
        time: "09:31",
        side: "right",
        body: "Acknowledged. The React copy will keep all state local for now.",
      },
    ],
  },
];

const attachmentOptions: AttachmentOption[] = [
  { id: "local-context", name: "local-context.md", detail: "queued", icon: "file-text" },
  { id: "selection-snippet", name: "selection.tsx", detail: "snippet", icon: "code" },
  { id: "handoff-checklist", name: "handoff checklist", detail: "note", icon: "tag" },
];

const initialUnreadByChat = conversations.reduce<Record<string, number>>((map, c) => {
  map[c.id] = c.unread;
  return map;
}, {} as Record<string, number>);

/* ---- Helpers -------------------------------------------- */
function formatClock(date = new Date()) {
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function getLastMessageSummary(msg: Message) {
  const prefix = msg.attachments?.length ? `[${msg.attachments.length} attachments] ` : "";
  return `${prefix}${msg.body}`;
}

function messageMatchesQuery(msg: Message, query: string) {
  if (!query) return true;
  const haystack = [
    msg.author, msg.role, msg.body,
    msg.quote?.title, msg.quote?.body,
    msg.code?.file,
    ...(msg.code?.lines ?? []),
    ...(msg.attachments?.flatMap((a) => [a.name, a.detail]) ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

function conversationMatchesQuery(conv: ConversationSnapshot, query: string) {
  if (!query) return true;
  const haystack = [conv.name, conv.initials, conv.role, conv.currentSummary, conv.currentTime]
    .join(" ").toLowerCase();
  return haystack.includes(query) || conv.allMessages.some((m) => messageMatchesQuery(m, query));
}

/* ---- Sub-components ------------------------------------- */

interface AvatarProps {
  initials: string;
  accent?: Accent;
  size?: "sm" | "md";
}

function Avatar({ initials, accent = "blue", size = "md" }: AvatarProps) {
  const accentClass = accent === "cyan" ? styles.avatarCyan : accent === "purple" ? styles.avatarPurple : "";
  const sizeClass = size === "sm" ? styles.avatarSm : "";
  return (
    <span className={[styles.avatar, accentClass, sizeClass].filter(Boolean).join(" ")}>
      {initials}
    </span>
  );
}

function iconForOption(icon: AttachmentOption["icon"]) {
  switch (icon) {
    case "code": return <Code size={16} />;
    case "tag": return <Tag size={16} />;
    default: return <FileText size={16} />;
  }
}

/* ---- ConversationList ----------------------------------- */

interface ConversationListProps {
  conversations: ConversationSnapshot[];
  activeId: string;
  searchQuery: string;
  onSelect: (id: string) => void;
  onSearchChange: (q: string) => void;
}

function ConversationList({ conversations: convs, activeId, searchQuery, onSelect, onSearchChange }: ConversationListProps) {
  return (
    <aside className={`${styles.sidebar} ${styles.panel}`}>
      <header className={styles.header}>
        <button className={styles.iconBtn} type="button" aria-label="Back to workspace">
          <ArrowLeft size={18} />
        </button>
        <div className={styles.title}>
          <div className={styles.eyebrow}>AgentHub</div>
          <h2>Private Chats</h2>
          <p>Direct coordination workspace</p>
        </div>
      </header>

      <div className={styles.searchWrap}>
        <Search className={styles.searchIcon} size={16} />
        <input
          className={styles.searchInput}
          aria-label="Search private chats"
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search people, handoffs, snippets..."
          type="search"
          value={searchQuery}
        />
      </div>

      <div className={styles.sectionTitle}>Pinned Threads</div>
      {searchQuery.trim() ? (
        <div className={styles.filterNote}>
          {convs.length} chats match &ldquo;{searchQuery.trim()}&rdquo;
        </div>
      ) : null}
      <div className={styles.chatList}>
        {convs.length > 0 ? (
          convs.map((conv) => (
            <button
              key={conv.id}
              className={`${styles.chatCard} ${conv.id === activeId ? styles.chatCardActive : ""}`}
              type="button"
              onClick={() => onSelect(conv.id)}
            >
              <Avatar initials={conv.initials} accent={conv.accent} size="sm" />
              <span className={styles.chatCardBody}>
                <h3>{conv.name}</h3>
                <p>{conv.currentSummary}</p>
              </span>
              <span className={styles.chatCardMeta}>
                <span className={styles.time}>{conv.currentTime}</span>
                {conv.currentUnread > 0 ? (
                  <span className={styles.unread}>{conv.currentUnread}</span>
                ) : null}
              </span>
            </button>
          ))
        ) : (
          <div className={styles.empty}>No private chats match this search.</div>
        )}
      </div>
    </aside>
  );
}

/* ---- MessageBubble -------------------------------------- */

interface MessageBubbleProps {
  message: Message;
  isKeyed: boolean;
  onToggleKey: () => void;
  conversationAccent: Accent;
}

function MessageBubble({ message, isKeyed, onToggleKey, conversationAccent }: MessageBubbleProps) {
  const isMine = message.side === "right";
  return (
    <article className={`${styles.messageRow} ${isMine ? styles.messageRowMine : ""}`}>
      <span className={styles.avatarCell}>
        <Avatar
          initials={isMine ? "ME" : "??"}
          accent={isMine ? "purple" : (message.accent ?? conversationAccent)}
        />
      </span>
      <div className={styles.messageStack}>
        <div className={styles.messageMeta}>
          <strong>{message.author}</strong>
          <span>{message.time}</span>
          <span>{message.role}</span>
          <button
            className={`${styles.keyBtn} ${isKeyed ? styles.keyBtnActive : ""}`}
            type="button"
            onClick={onToggleKey}
            aria-pressed={isKeyed}
          >
            {isKeyed ? "Keyed" : "Mark key"}
          </button>
        </div>

        <div className={`${styles.bubble} ${isMine ? styles.bubbleMine : ""} ${message.isDraft ? styles.bubbleDraft : ""}`}>
          {message.quote ? (
            <div className={styles.quote}>
              <strong>{message.quote.title}</strong>
              <br />
              {message.quote.body}
            </div>
          ) : null}
          {message.body}

          {message.attachments ? (
            <div className={styles.attachmentList}>
              {message.attachments.map((att) => (
                <span className={styles.attachment} key={`${message.id}-${att.name}`}>
                  <FileText size={16} />
                  <span>{att.name} - {att.detail}</span>
                </span>
              ))}
            </div>
          ) : null}

          {message.code ? (
            <div className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span>{message.code.file}</span>
                <span>snippet</span>
              </div>
              <pre className={styles.codeBody}>
                {message.code.lines.map((line, i) => (
                  <code className={styles.codeLine} key={`${message.id}-line-${i}`}>{line}</code>
                ))}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/* ---- ChatInput ------------------------------------------ */

interface ChatInputProps {
  draft: string;
  onDraftChange: (v: string) => void;
  attachmentsOpen: boolean;
  onToggleAttachments: () => void;
  selectedAttachmentIds: string[];
  onToggleAttachment: (id: string) => void;
  onRemoveAttachment: (id: string) => void;
  onInsertCode: () => void;
  onQuoteLatest: () => void;
  onSend: () => void;
  hasContent: boolean;
  messagesCount: number;
}

function ChatInput({
  draft,
  onDraftChange,
  attachmentsOpen,
  onToggleAttachments,
  selectedAttachmentIds,
  onToggleAttachment,
  onRemoveAttachment,
  onInsertCode,
  onQuoteLatest,
  onSend,
  hasContent,
  messagesCount,
}: ChatInputProps) {
  const selected = attachmentOptions.filter((a) => selectedAttachmentIds.includes(a.id));

  return (
    <div className={styles.composerWrap}>
      {attachmentsOpen ? (
        <div className={`${styles.attachmentTray} ${styles.panel}`} aria-label="Attachment panel">
          {attachmentOptions.map((att) => {
            const isSelected = selectedAttachmentIds.includes(att.id);
            return (
              <button
                key={att.id}
                className={`${styles.attachment} ${isSelected ? styles.attachmentActive : ""}`}
                type="button"
                onClick={() => onToggleAttachment(att.id)}
                aria-pressed={isSelected}
              >
                {iconForOption(att.icon)}
                {att.name} - {att.detail}
              </button>
            );
          })}
        </div>
      ) : null}

      {selected.length > 0 ? (
        <div className={styles.selectedAttachments} aria-label="Selected attachments">
          {selected.map((att) => (
            <button
              key={att.id}
              className={`${styles.attachment} ${styles.attachmentActive}`}
              type="button"
              onClick={() => onRemoveAttachment(att.id)}
              aria-label={`Remove ${att.name}`}
            >
              {iconForOption(att.icon)}
              {att.name} - {att.detail}
            </button>
          ))}
        </div>
      ) : null}

      <div className={`${styles.composer} ${styles.panel}`}>
        <div className={styles.composerTools}>
          <button
            className={`${styles.iconBtn} ${attachmentsOpen ? styles.iconBtnActive : ""}`}
            type="button"
            aria-label="Toggle attachment panel"
            onClick={onToggleAttachments}
          >
            <Plus size={18} />
          </button>
          <button className={styles.iconBtn} type="button" aria-label="Insert code" onClick={onInsertCode}>
            <Code size={18} />
          </button>
          <button
            className={styles.iconBtn}
            type="button"
            aria-label="Quote selected message"
            disabled={messagesCount === 0}
            onClick={onQuoteLatest}
          >
            <Quote size={18} />
          </button>
        </div>

        <textarea
          className={styles.composerTextarea}
          aria-label="Message"
          placeholder="Write a private note, paste a code fragment, or attach handoff context..."
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
        />

        <div className={styles.composerActions}>
          <button className={styles.iconBtn} disabled type="button" aria-label="Voice note unavailable">
            <Mic size={18} />
          </button>
          <button className={styles.sendBtn} disabled={!hasContent} onClick={onSend} type="button">
            <Send size={18} />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- DetailPanel ---------------------------------------- */

interface DetailPanelProps {
  conversation: ConversationSnapshot;
  activeKeyCount: number;
  reviewProgress: number;
  localMessageCount: number;
  activeAttachments: Attachment[];
  activeCodeBlock?: CodeBlock;
  attachmentsOpen: boolean;
  keyOnly: boolean;
  selectedCount: number;
  normalizedSearch: string;
  onShowNotice: (text: string) => void;
}

function DetailPanel({
  conversation,
  activeKeyCount,
  reviewProgress,
  localMessageCount,
  activeAttachments,
  activeCodeBlock,
  attachmentsOpen,
  keyOnly,
  selectedCount,
  normalizedSearch,
  onShowNotice,
}: DetailPanelProps) {
  return (
    <aside className={`${styles.contextPanel} ${styles.panel}`}>
      <header className={`${styles.header} ${styles.headerBetween}`}>
        <div className={styles.title}>
          <div className={styles.eyebrow}>Thread Context</div>
          <h2>{conversation.name}</h2>
          <p>{conversation.allMessages.length} messages - {reviewProgress}% reviewed</p>
        </div>
        <button
          className={styles.iconBtn}
          type="button"
          aria-label="Open context"
          onClick={() => onShowNotice("Context details stay in this local preview")}
        >
          <ExternalLink size={18} />
        </button>
      </header>

      <div className={styles.contextBody}>
        <section className={styles.miniCard}>
          <h3>Review Progress</h3>
          <div className={styles.progress}>
            <span className={styles.progressFill} style={{ width: `${reviewProgress}%` }} />
          </div>
          <p style={{ marginTop: 10 }}>
            {activeKeyCount} key messages, {conversation.currentUnread} unread, and{" "}
            {localMessageCount} local drafts in this thread.
          </p>
        </section>

        <section className={styles.miniCard}>
          <h3>Attachments</h3>
          {activeAttachments.length > 0 ? (
            <ul>
              {activeAttachments.map((att, i) => (
                <li key={`${att.name}-${i}`}>{att.name} - {att.detail}</li>
              ))}
            </ul>
          ) : (
            <p>No linked attachments for this conversation yet.</p>
          )}
        </section>

        <section className={styles.miniCard}>
          <h3>Code Snippets</h3>
          {activeCodeBlock ? (
            <div className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span>{activeCodeBlock.file}</span>
                <span>local</span>
              </div>
              <pre className={styles.codeBody}>
                {activeCodeBlock.lines.map((line, i) => (
                  <code className={styles.codeLine} key={`${activeCodeBlock.file}-${i}`}>{line}</code>
                ))}
              </pre>
            </div>
          ) : (
            <p>No code snippets are linked to this private chat.</p>
          )}
        </section>

        <section className={styles.miniCard}>
          <h3>Visible State</h3>
          <div className={styles.chipRow}>
            <span className={styles.chip}>chat: {conversation.name}</span>
            <span className={styles.chip}>attachments: {attachmentsOpen ? "open" : "closed"}</span>
            <span className={styles.chip}>filter: {keyOnly ? "keyed" : "all"}</span>
            <span className={styles.chip}>search: {normalizedSearch || "none"}</span>
            <span className={styles.chip}>selected: {selectedCount}</span>
          </div>
        </section>
      </div>
    </aside>
  );
}

/* ---- Main Component ------------------------------------- */

export default function PrivateChatsPage() {
  const [activeChatId, setActiveChatId] = useState(conversations[0].id);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [keyOnly, setKeyOnly] = useState(false);
  const [keyedMessages, setKeyedMessages] = useState<string[]>(["mira-2"]);
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>({});
  const [unreadByChat, setUnreadByChat] = useState<Record<string, number>>(initialUnreadByChat);
  const [searchQuery, setSearchQuery] = useState("routing handoff");
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const conversationSnapshots = useMemo<ConversationSnapshot[]>(() =>
    conversations.map((conv) => {
      const allMsgs = [...conv.messages, ...(localMessages[conv.id] ?? [])];
      const last = allMsgs[allMsgs.length - 1];
      return {
        ...conv,
        allMessages: allMsgs,
        currentSummary: last ? getLastMessageSummary(last) : conv.summary,
        currentTime: last?.time ?? conv.time,
        currentUnread: unreadByChat[conv.id] ?? 0,
      };
    }), [localMessages, unreadByChat]);

  const activeConv = useMemo(
    () => conversationSnapshots.find((c) => c.id === activeChatId) ?? conversationSnapshots[0],
    [activeChatId, conversationSnapshots],
  );

  const filteredConvs = useMemo(
    () => conversationSnapshots.filter((c) => conversationMatchesQuery(c, normalizedSearch)),
    [conversationSnapshots, normalizedSearch],
  );

  const selectedAttachments = useMemo(
    () => attachmentOptions.filter((a) => selectedAttachmentIds.includes(a.id)),
    [selectedAttachmentIds],
  );

  const messages = useMemo(() => {
    const filtered = keyOnly
      ? activeConv.allMessages.filter((m) => keyedMessages.includes(m.id))
      : activeConv.allMessages;
    return filtered.filter((m) => messageMatchesQuery(m, normalizedSearch));
  }, [activeConv, keyOnly, keyedMessages, normalizedSearch]);

  const activeKeyCount = useMemo(
    () => activeConv.allMessages.filter((m) => keyedMessages.includes(m.id)).length,
    [activeConv, keyedMessages],
  );

  const activeAttachments = useMemo(
    () =>
      activeConv.allMessages
        .flatMap((m) => m.attachments ?? [])
        .concat(selectedAttachments.map(({ name, detail }) => ({ name, detail }))),
    [activeConv, selectedAttachments],
  );

  const activeCodeBlock = useMemo(
    () => activeConv.allMessages.find((m) => m.code)?.code,
    [activeConv],
  );

  const reviewProgress = Math.min(100, Math.round(
    ((activeKeyCount + selectedAttachments.length + (localMessages[activeConv.id]?.length ?? 0)) /
      Math.max(activeConv.allMessages.length + 2, 1)) * 100,
  ));

  const hasComposerContent = draft.trim().length > 0 || selectedAttachments.length > 0;

  const showNotice = (text: string, tone: Notice["tone"] = "info") => {
    setNotice({ id: Date.now(), text, tone });
    setTimeout(() => setNotice(null), 3200);
  };

  const selectConversation = (chatId: string) => {
    setActiveChatId(chatId);
    setUnreadByChat((cur) => ({ ...cur, [chatId]: 0 }));
    const next = conversationSnapshots.find((c) => c.id === chatId);
    if (next?.currentUnread) {
      showNotice(`${next.name} marked as read`, "success");
    }
  };

  const toggleAttachment = (attId: string) => {
    const att = attachmentOptions.find((o) => o.id === attId);
    const isSelected = selectedAttachmentIds.includes(attId);
    setSelectedAttachmentIds((cur) =>
      cur.includes(attId) ? cur.filter((id) => id !== attId) : [...cur, attId],
    );
    if (att) showNotice(`${isSelected ? "Removed" : "Selected"} ${att.name}`);
  };

  const removeAttachment = (attId: string) => {
    const att = attachmentOptions.find((o) => o.id === attId);
    setSelectedAttachmentIds((cur) => cur.filter((id) => id !== attId));
    showNotice(`${att?.name ?? "Attachment"} removed`);
  };

  const toggleKeyedMessage = (msgId: string) => {
    const msg = activeConv.allMessages.find((m) => m.id === msgId);
    const isKeyed = keyedMessages.includes(msgId);
    setKeyedMessages((cur) =>
      cur.includes(msgId) ? cur.filter((id) => id !== msgId) : [...cur, msgId],
    );
    showNotice(
      `${isKeyed ? "Removed from" : "Marked as"} key: ${msg?.author ?? "message"}`,
      isKeyed ? "info" : "success",
    );
  };

  const insertCodeSnippet = () => {
    setDraft((cur) => `${cur}${cur ? "\n\n" : ""}\`\`\`tsx\n// paste selected snippet here\n\`\`\``);
    showNotice("Code block inserted into the local draft");
  };

  const quoteLatestMessage = () => {
    const source =
      [...activeConv.allMessages].reverse().find((m) => keyedMessages.includes(m.id)) ??
      activeConv.allMessages[activeConv.allMessages.length - 1];
    if (!source) return;
    setDraft((cur) => `${cur}${cur ? "\n\n" : ""}> ${source.body.slice(0, 120)}`);
    showNotice(`Quoted ${source.author}'s latest context`);
  };

  const sendDraft = () => {
    if (!hasComposerContent) {
      showNotice("Write a message or select an attachment before sending");
      return;
    }
    const text = draft.trim();
    const atts = selectedAttachments.map(({ name, detail }) => ({ name, detail }));
    const msg: Message = {
      id: `local-${activeConv.id}-${Date.now()}`,
      author: "You",
      role: "Local draft",
      time: formatClock(),
      side: "right",
      body: text || "Attached selected context for review.",
      isDraft: true,
      attachments: atts.length > 0 ? atts : undefined,
    };
    setLocalMessages((cur) => ({
      ...cur,
      [activeConv.id]: [...(cur[activeConv.id] ?? []), msg],
    }));
    setUnreadByChat((cur) => ({ ...cur, [activeConv.id]: 0 }));
    setSelectedAttachmentIds([]);
    setAttachmentsOpen(false);
    setDraft("");
    showNotice("Local draft appended to this private thread", "success");
  };

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <ConversationList
          conversations={filteredConvs}
          activeId={activeConv.id}
          searchQuery={searchQuery}
          onSelect={selectConversation}
          onSearchChange={setSearchQuery}
        />

        <main className={`${styles.chatPanel} ${styles.panel}`}>
          {/* Chat Header */}
          <header className={`${styles.header} ${styles.headerBetween}`}>
            <div className={styles.headerStart}>
              <Avatar initials={activeConv.initials} accent={activeConv.accent} />
              <div className={styles.title}>
                <h2>{activeConv.name}</h2>
                <p>{activeConv.role} - private thread</p>
              </div>
              <span className={styles.status}>
                <span className={styles.statusDot} />
                Online
              </span>
            </div>

            <div className={styles.actions}>
              <button
                className={`${styles.iconBtn} ${keyOnly ? styles.iconBtnActive : ""}`}
                type="button"
                disabled={activeConv.allMessages.length === 0}
                onClick={() => setKeyOnly((cur) => !cur)}
                aria-pressed={keyOnly}
                aria-label="Show key messages only"
              >
                <Star size={18} />
              </button>
              <button
                className={`${styles.iconBtn} ${attachmentsOpen ? styles.iconBtnActive : ""}`}
                type="button"
                onClick={() => setAttachmentsOpen((cur) => !cur)}
                aria-expanded={attachmentsOpen}
                aria-label="Open attachments"
              >
                <Paperclip size={18} />
              </button>
              <button
                className={styles.iconBtn}
                type="button"
                aria-label="More actions"
                onClick={() => showNotice("More actions are local-preview only")}
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          </header>

          {/* Messages */}
          <section className={styles.messages} aria-label="Message thread">
            {messages.length > 0 ? (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isKeyed={keyedMessages.includes(msg.id)}
                  onToggleKey={() => toggleKeyedMessage(msg.id)}
                  conversationAccent={activeConv.accent}
                />
              ))
            ) : (
              <div className={styles.empty}>
                {keyOnly
                  ? "No key messages match the current view."
                  : normalizedSearch
                    ? "No messages match this search in the selected conversation."
                    : "This private thread is empty."}
              </div>
            )}
          </section>

          {/* Notice + Composer */}
          <div className={styles.composerWrap}>
            {notice ? (
              <div className={`${styles.notice} ${notice.tone === "success" ? styles.noticeSuccess : ""}`} role="status">
                <span>{notice.text}</span>
                <span className={styles.noticeActions}>
                  {normalizedSearch ? (
                    <button className={styles.chip} type="button" onClick={() => setSearchQuery("")}>
                      Clear search
                    </button>
                  ) : null}
                  <button className={styles.chip} type="button" onClick={() => setNotice(null)}>
                    Dismiss
                  </button>
                </span>
              </div>
            ) : null}

            <ChatInput
              draft={draft}
              onDraftChange={setDraft}
              attachmentsOpen={attachmentsOpen}
              onToggleAttachments={() => setAttachmentsOpen((cur) => !cur)}
              selectedAttachmentIds={selectedAttachmentIds}
              onToggleAttachment={toggleAttachment}
              onRemoveAttachment={removeAttachment}
              onInsertCode={insertCodeSnippet}
              onQuoteLatest={quoteLatestMessage}
              onSend={sendDraft}
              hasContent={hasComposerContent}
              messagesCount={activeConv.allMessages.length}
            />
          </div>
        </main>

        <DetailPanel
          conversation={activeConv}
          activeKeyCount={activeKeyCount}
          reviewProgress={reviewProgress}
          localMessageCount={localMessages[activeConv.id]?.length ?? 0}
          activeAttachments={activeAttachments}
          activeCodeBlock={activeCodeBlock}
          attachmentsOpen={attachmentsOpen}
          keyOnly={keyOnly}
          selectedCount={selectedAttachments.length}
          normalizedSearch={normalizedSearch}
          onShowNotice={(text) => showNotice(text)}
        />
      </div>
    </div>
  );
}
