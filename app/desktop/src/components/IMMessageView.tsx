// IMMessageView.tsx — IM chat bubble view for AgentHub Desktop.
// Renders a scrollable list of IM chat messages with self/other/agent alignment,
// authority color bands, timestamps on hover, markdown content, and send error retry.
//
// Reference: docs/reference/cross-comparison/02-im-ux.md Section 2.3 / 3.2

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, AlertTriangle, RefreshCw } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import EmptyState from './EmptyState';
import { useToastStore } from '@/stores/toastStore';
import styles from './IMMessageView.module.css';

// ── Public types ─────────────────────────────────

export interface IMMessage {
  id: string;
  sessionId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  timestamp: string;
  isAgent: boolean;
  authority?: 'owner' | 'admin' | 'member';
  attachments?: { id: string; name: string; url: string }[];
  /** Whether this message failed to send (client-side state). */
  sendFailed?: boolean;
}

export interface IMMessageViewProps {
  messages: IMMessage[];
  currentUserId: string;
  onSend: (content: string) => void;
  onRecall?: (messageId: string) => void;
  /** Whether a message is currently being sent. */
  sending?: boolean;
  /** A pending (optimistic) message shown while sending. */
  pendingMessage?: string | null;
}

// ── Authority color band resolver ───────────────

const AUTHORITY_BAND: Record<string, string> = {
  owner: styles.authorityOwner,
  admin: styles.authorityAdmin,
  member: styles.authorityMember,
};

// ── Relative time formatter ──────────────────────

function relativeTime(timestamp: string): { relative: string; exact: string } {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const exact = new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  if (minutes < 1) return { relative: 'Just now', exact };
  if (minutes < 60) return { relative: `${minutes} min ago`, exact };
  if (hours < 24) return { relative: `${hours}h ago`, exact };
  if (days === 1) return { relative: 'Yesterday', exact };
  if (days < 7) return { relative: `${days}d ago`, exact };

  const shortDate = new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return { relative: shortDate, exact };
}

// ── Sender avatar initial ────────────────────────

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '?';
}

// ── Single message bubble ────────────────────────

interface BubbleProps {
  msg: IMMessage;
  isSelf: boolean;
  onRecall?: (messageId: string) => void;
}

function MessageBubble({ msg, isSelf, onRecall }: BubbleProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const rt = relativeTime(msg.timestamp);

  const authorityClass = msg.authority ? AUTHORITY_BAND[msg.authority] ?? '' : '';

  let wrapperClass = styles.bubbleWrapper;
  if (isSelf) wrapperClass += ' ' + styles.self;
  else if (msg.isAgent) wrapperClass += ' ' + styles.agent;
  else wrapperClass += ' ' + styles.other;

  let bubbleClass = styles.bubble;
  if (isSelf) bubbleClass += ' ' + styles.bubbleSelf;
  else if (msg.isAgent) bubbleClass += ' ' + styles.bubbleAgent;
  else bubbleClass += ' ' + styles.bubbleOther;
  if (authorityClass) bubbleClass += ' ' + authorityClass;
  if (msg.sendFailed) bubbleClass += ' ' + styles.bubbleFailed;

  return (
    <div
      className={wrapperClass}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Sender info (non-self only) */}
      {!isSelf && (
        <div className={styles.senderRow}>
          {msg.senderAvatar ? (
            <img
              className={styles.avatar}
              src={msg.senderAvatar}
              alt={msg.senderName}
            />
          ) : (
            <div
              className={`${styles.avatar} ${msg.isAgent ? styles.avatarAgent : styles.avatarUser}`}
            >
              {avatarInitial(msg.senderName)}
            </div>
          )}
          <span className={styles.senderName}>
            {msg.senderName}
            {msg.isAgent && (
              <span className={styles.agentTag}>{t('im.message.agentLabel')}</span>
            )}
          </span>
        </div>
      )}

      {/* Bubble body */}
      <div className={bubbleClass}>
        {/* Authority band */}
        {msg.authority && <div className={`${styles.authorityBand} ${authorityClass}`} />}

        {/* Markdown content */}
        <div className={styles.content}>
          <MarkdownRenderer content={msg.content} />
        </div>

        {/* Attachments */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className={styles.attachments}>
            {msg.attachments.map((att) => (
              <a
                key={att.id}
                className={styles.attachment}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {att.name}
              </a>
            ))}
          </div>
        )}

        {/* Send failed indicator */}
        {msg.sendFailed && (
          <div className={styles.sendFailedIndicator}>
            <AlertTriangle size={14} />
            <span>{t('im.message.sendFailed')}</span>
          </div>
        )}
      </div>

      {/* Timestamp (visible on hover) */}
      {hovered && (
        <div className={styles.timestamp} title={rt.exact}>
          {rt.relative}
        </div>
      )}

      {/* Action bar on hover */}
      {hovered && (
        <div className={styles.actionBar}>
          {msg.sendFailed && (
            <button
              className={styles.actionBtn}
              title={t('im.message.retry')}
              onClick={() => onRecall?.(msg.id)}
            >
              <RefreshCw size={14} />
            </button>
          )}
          {onRecall && !msg.sendFailed && (
            <button
              className={styles.actionBtn}
              title={t('im.message.recall')}
              onClick={() => onRecall(msg.id)}
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────

export default function IMMessageView({
  messages,
  currentUserId,
  onSend,
  onRecall,
  sending = false,
  pendingMessage = null,
}: IMMessageViewProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pendingMessage]);

  return (
    <div className={styles.root}>
      {/* Message list */}
      <div ref={scrollRef} className={styles.stream} role="log" aria-live="polite">
        {messages.length === 0 && !pendingMessage ? (
          <EmptyState
            icon={<Send size={24} />}
            title={t('im.message.empty')}
            description=""
          />
        ) : (
          <div className={styles.messageList}>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isSelf={msg.senderId === currentUserId}
                onRecall={onRecall}
              />
            ))}

            {/* Pending/optimistic message */}
            {pendingMessage && (
              <div className={`${styles.bubbleWrapper} ${styles.self}`}>
                <div className={`${styles.bubble} ${styles.bubbleSelf} ${styles.bubblePending}`}>
                  <div className={styles.content}>
                    <MarkdownRenderer content={pendingMessage} />
                  </div>
                  <div className={styles.sendingIndicator}>
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                    <span>{t('im.message.loading')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
