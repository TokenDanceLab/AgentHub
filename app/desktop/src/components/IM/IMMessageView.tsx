import { useRef, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import type { IMMessage } from './types';
import styles from './IMMessageView.module.css';

interface IMMessageViewProps {
  messages: IMMessage[];
  currentUserId?: string;
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  const now = Date.now();
  const diff = now - d.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function authorityClass(authority: string): string {
  switch (authority) {
    case 'edge':
      return styles.authorityEdge;
    case 'hybrid':
      return styles.authorityHybrid;
    default:
      return styles.authorityHub;
  }
}

function authorityBadgeClass(authority: string): string {
  switch (authority) {
    case 'edge':
      return styles.authorityBadgeEdge;
    case 'hybrid':
      return styles.authorityBadgeHybrid;
    default:
      return styles.authorityBadgeHub;
  }
}

function SenderAvatar({
  name,
  senderType,
}: {
  name: string;
  senderType: 'user' | 'agent';
}) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <span
      className={`${styles.avatar} ${senderType === 'agent' ? styles.avatarAgent : styles.avatarUser}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

const IMMessageBubble = memo(function IMMessageBubble({
  message,
  isOwn,
}: {
  message: IMMessage;
  isOwn: boolean;
}) {
  const { t } = useTranslation();
  const label = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const translated = t(key, vars);
    return translated === key ? fallback : translated;
  };
  const isRecalled = message.content === '[Message recalled]';

  return (
    <div
      className={`${styles.bubble} ${
        isOwn ? styles.userBubble : styles.agentBubble
      }`}
      role="article"
      aria-label={`${message.senderType} message from ${message.senderName}`}
    >
      {/* Authority color band (left edge for agent messages) */}
      <div
        className={`${styles.authorityBand} ${authorityClass(message.authority)}`}
        aria-hidden="true"
      />

      {/* Sender row */}
      <div className={styles.senderRow}>
        <SenderAvatar name={message.senderName} senderType={message.senderType} />
        <span className={styles.senderName}>{message.senderName}</span>
        <span className={`${styles.authorityBadge} ${authorityBadgeClass(message.authority)}`}>
          {message.authority}
        </span>
      </div>

      {/* Content */}
      <div className={`${styles.content} ${isRecalled ? styles.recalled : ''}`}>
        <MarkdownRenderer content={message.content} />
      </div>

      <div className={styles.messageMeta}>
        <time className={styles.timestamp} dateTime={message.timestamp}>
          {formatTime(message.timestamp)}
        </time>
        {message.recalled || isRecalled ? (
          <span>{label('im.message.recalledStatus', 'Recalled on Hub')}</span>
        ) : message.read ? (
          <span>
            {label('im.message.readStatus', `Read by ${message.readBy ?? 'Hub member'}`, {
              reader: message.readBy ?? label('im.message.unknownReader', 'Hub member'),
            })}
          </span>
        ) : isOwn ? (
          <span>{label('im.message.sentStatus', 'Sent through Hub')}</span>
        ) : null}
      </div>
    </div>
  );
});

const IMMessageView = memo(function IMMessageView({
  messages,
  currentUserId,
}: IMMessageViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          <span>No messages yet</span>
          <span>Start a conversation to begin</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.stream} role="log" aria-live="polite">
        {messages.map((msg) => {
          const isOwn = currentUserId ? msg.senderId === currentUserId : msg.senderType === 'user';
          return (
            <div
              key={msg.id}
              className={isOwn ? styles.userRow : styles.agentRow}
            >
              <IMMessageBubble message={msg} isOwn={isOwn} />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});

export default IMMessageView;
