import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Button, SearchInput } from '@shared/ui';
import { ParticleCanvas } from '@/components/ParticleCanvas';
import { WebLayout } from '@/components/WebLayout';
import styles from './PrivateChatsPage.module.css';

/* ---- inline mock data (static prototype) ---- */

type MockThread = { id: string; title: string; projectId: string; status: string };
type MockMessage = { id: string; role: string; content: string; threadId: string };

const mockThreads: MockThread[] = [
  { id: 'thread-01', title: 'Frontend page review', projectId: 'ui-coordination', status: 'active' },
  { id: 'thread-02', title: 'CSS module migration', projectId: 'ui-coordination', status: 'archived' },
  { id: 'thread-03', title: 'TypeScript migration', projectId: 'infra', status: 'active' },
];

const mockMessages: MockMessage[] = [
  { id: 'msg-001', role: 'user', content: 'Can we review the AgentSquare page layout? I think the stats row needs to be 4 columns instead of 3.', threadId: 'thread-01' },
  { id: 'msg-002', role: 'agent', content: 'Looking at AgentSquare. The stats row currently uses grid-template-columns: repeat(3, minmax(0, 1fr)). I would recommend moving to repeat(4, minmax(0, 1fr)) to match the convention we are using in Workbench and Projects.', threadId: 'thread-01' },
  { id: 'msg-003', role: 'user', content: 'Good catch. Also, do we need a confirmation bar like the other pages?', threadId: 'thread-01' },
  { id: 'msg-004', role: 'agent', content: 'Yes — AgentSquare already has a confirmation bar via a fixed-position element at the root level. It shows feedback when users add/remove agents or toggle favorites. It follows the same pattern as GroupWorkspace.', threadId: 'thread-01' },
  { id: 'msg-005', role: 'user', content: 'CSS modules migration plan for PrivateChats', threadId: 'thread-02' },
  { id: 'msg-006', role: 'agent', content: 'PrivateChats currently uses inline styles. I will migrate to PrivateChatsPage.module.css with design tokens (var(--primary), var(--border), etc.) and the import styles pattern.', threadId: 'thread-02' },
];

/* ---- Mock Event Stream (static prototype) ---- */

type StreamEvent = { type: string; payload: Record<string, unknown> };

class MockEventStream {
  private listeners: Map<string, Array<(event: StreamEvent) => void>> = new Map();
  private destroyed = false;

  onType(type: string, listener: (event: StreamEvent) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
    return () => {
      if (this.destroyed) return;
      const arr = this.listeners.get(type);
      if (arr) this.listeners.set(type, arr.filter((l) => l !== listener));
    };
  }

  emit(event: StreamEvent) {
    if (this.destroyed) return;
    const handlers = this.listeners.get(event.type);
    if (handlers) handlers.forEach((h) => h(event));
  }

  destroy() { this.destroyed = true; this.listeners.clear(); }
}

function playMessageStream(stream: MockEventStream, opts?: { messageId?: string; threadId?: string; chunkDelayMs?: number }) {
  const msgId = opts?.messageId ?? 'stream-msg';
  const chunks = ['Starting', ' the review ', 'of the current ', 'codebase changes.', '\n\nKey findings:', '\n- No type errors', '\n- All pages use CSS Modules', '\n- i18n keys are complete'];
  let i = 0;
  const interval = setInterval(() => {
    if (i < chunks.length) {
      stream.emit({ type: 'message.delta', payload: { messageId: msgId, delta: chunks[i] } });
      i++;
    } else {
      clearInterval(interval);
    }
  }, opts?.chunkDelayMs ?? 80);
  return () => clearInterval(interval);
}

type Accent = 'blue' | 'cyan' | 'purple';
type Attachment = { name: string; detail: string };
type CodeBlock = { file: string; lines: string[] };
type QuoteBlock = { title: string; body: string };

type Message = {
  id: string; author: string; role: string; time: string; side: 'left' | 'right';
  body: string; accent?: Accent; attachments?: Attachment[]; code?: CodeBlock;
  quote?: QuoteBlock; isDraft?: boolean;
};

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

const attachmentOptions: AttachmentOption[] = [
  { id: 'local-context', name: 'local-context.md', detail: 'queued', icon: 'description' },
  { id: 'selection-snippet', name: 'selection.tsx', detail: 'snippet', icon: 'code' },
  { id: 'handoff-checklist', name: 'handoff checklist', detail: 'note', icon: 'tag' },
];

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
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [keyOnly, setKeyOnly] = useState(false);
  const [keyedMessages, setKeyedMessages] = useState<string[]>(mockMessages.slice(0, 1).map((m) => m.id));
  const [draft, setDraft] = useState('');
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>({});
  const [unreadByChat, setUnreadByChat] = useState<Record<string, number>>(initialUnreadByChat);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const conversationSnapshots = useMemo<ConversationSnapshot[]>(() => conversations.map((c) => {
    const all = [...c.messages, ...(localMessages[c.id] ?? [])];
    const last = all[all.length - 1];
    return { ...c, allMessages: all, currentSummary: last ? getLastMessageSummary(last) : c.summary, currentTime: last?.time ?? c.time, currentUnread: unreadByChat[c.id] ?? 0 };
  }), [localMessages, unreadByChat]);

  const activeConv = useMemo(() => conversationSnapshots.find((c) => c.id === activeChatId) ?? conversationSnapshots[0]!, [activeChatId, conversationSnapshots]);
  const filteredConversations = useMemo(() => conversationSnapshots.filter((c) => conversationMatchesQuery(c, normalizedSearch)), [conversationSnapshots, normalizedSearch]);
  const selectedAttachments = useMemo(() => attachmentOptions.filter((a) => selectedAttachmentIds.includes(a.id)), [selectedAttachmentIds]);

  const messages = useMemo(() => {
    const filtered = keyOnly ? activeConv.allMessages.filter((m) => keyedMessages.includes(m.id)) : activeConv.allMessages;
    return filtered.filter((m) => messageMatchesQuery(m, normalizedSearch));
  }, [activeConv, keyOnly, keyedMessages, normalizedSearch]);

  const activeKeyCount = useMemo(() => activeConv.allMessages.filter((m) => keyedMessages.includes(m.id)).length, [activeConv, keyedMessages]);
  const activeAttachments = useMemo(() => activeConv.allMessages.flatMap((m) => m.attachments ?? []).concat(selectedAttachments.map(({ name, detail }) => ({ name, detail }))), [activeConv, selectedAttachments]);
  const activeCodeBlock = useMemo(() => activeConv.allMessages.find((m) => m.code)?.code, [activeConv]);
  const reviewProgress = Math.min(100, Math.round(((activeKeyCount + selectedAttachments.length + (localMessages[activeConv.id]?.length ?? 0)) / Math.max(activeConv.allMessages.length + 2, 1)) * 100));
  const hasComposerContent = draft.trim().length > 0 || selectedAttachments.length > 0;

  useEffect(() => {
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
      }
    });
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
      isDraft: true, attachments: msgAtts.length > 0 ? msgAtts : undefined,
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
    </div>
  );
}

export default PrivateChatsPage;
