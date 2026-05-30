import { useRef, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageBubble } from '@shared/ui';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import type { IMMessage } from './types';
import styles from './IMMessageView.module.css';

interface IMMessageViewProps {
  messages: IMMessage[];
  currentUserId?: string | undefined;
}

function formatTime(timestamp: string, justNowLabel: string): string {
  const d = new Date(timestamp);
  const now = Date.now();
  const diff = now - d.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return justNowLabel;
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
      return styles.bubbleEdge ?? '';
    case 'hybrid':
      return styles.bubbleHybrid ?? '';
    default:
      return styles.bubbleHub ?? '';
  }
}

function authorityBadgeClass(authority: string): string {
  switch (authority) {
    case 'edge':
      return styles.authorityBadgeEdge ?? '';
    case 'hybrid':
      return styles.authorityBadgeHybrid ?? '';
    default:
      return styles.authorityBadgeHub ?? '';
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
  justNowLabel,
}: {
  message: IMMessage;
  isOwn: boolean;
  justNowLabel: string;
}) {
  const isRecalled = message.content === '[Message recalled]';

  return (
    <MessageBubble
      className={styles.messageRow}
      bubbleClassName={`${styles.bubble} ${isOwn ? styles.userBubble : styles.agentBubble} ${authorityClass(message.authority)}`}
      metaClassName={styles.senderRow}
      contentClassName={`${styles.content} ${isRecalled ? styles.recalled : ''}`}
      align={isOwn ? 'end' : 'start'}
      contentAs="div"
      author={(
        <>
          <SenderAvatar name={message.senderName} senderType={message.senderType} />
          <span className={styles.senderName}>{message.senderName}</span>
          <span className={`${styles.authorityBadge} ${authorityBadgeClass(message.authority)}`}>
            {message.authority}
          </span>
        </>
      )}
      timestamp={formatTime(message.timestamp, justNowLabel)}
      ariaLabel={`${message.senderType} message from ${message.senderName}`}
    >
      <MarkdownRenderer content={message.content} />
    </MessageBubble>
  );
});

const IMMessageView = memo(function IMMessageView({
  messages,
  currentUserId,
}: IMMessageViewProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          <span>{t('im.message.emptyTitle')}</span>
          <span>{t('im.message.emptyDescription')}</span>
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
            <div key={msg.id} className={styles.messageItem}>
              <IMMessageBubble message={msg} isOwn={isOwn} justNowLabel={t('im.message.justNow')} />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});

export default IMMessageView;
