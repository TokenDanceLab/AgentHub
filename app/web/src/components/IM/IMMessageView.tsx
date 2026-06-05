import { useRef, useEffect, memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MessageSquareText, CornerUpLeft, Forward, RotateCcw } from 'lucide-react';
import { EmptyState, MessageBubble } from '@shared/ui';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import type { IMMessage } from './types';
import styles from './IMMessageView.module.css';

interface IMMessageViewProps {
  messages: IMMessage[];
  currentUserId?: string | undefined;
  onReply?: (message: IMMessage) => void;
  onRecall?: (message: IMMessage) => void;
  onForward?: (message: IMMessage) => void;
}

function localeFromLanguage(language: string | undefined): string {
  return language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function formatTime(timestamp: string, t: TFunction, language: string | undefined): string {
  const d = new Date(timestamp);
  const now = Date.now();
  const diff = now - d.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });

  return d.toLocaleTimeString(localeFromLanguage(language), {
    hour: 'numeric',
    minute: '2-digit',
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

/** Check if message can be recalled (own message, not already recalled, within 2 min) */
function canRecallMessage(message: IMMessage, currentUserId?: string): boolean {
  if (message.recalled || message.content === '[Message recalled]') return false;
  if (message.senderType !== 'user') return false;
  if (currentUserId && message.senderId !== currentUserId) return false;
  const elapsed = Date.now() - new Date(message.timestamp).getTime();
  return elapsed < 2 * 60 * 1000;
}

const IMMessageBubble = memo(function IMMessageBubble({
  message,
  isOwn,
  t,
  language,
  replyPreview,
  onReply,
  onRecall,
  onForward,
}: {
  message: IMMessage;
  isOwn: boolean;
  t: TFunction;
  language: string | undefined;
  replyPreview?: IMMessage | undefined;
  onReply?: (message: IMMessage) => void;
  onRecall?: (message: IMMessage) => void;
  onForward?: (message: IMMessage) => void;
}) {
  const isRecalled = message.content === '[Message recalled]';
  const senderTypeLabel = t(`im.message.sender.${message.senderType}`);
  const [hovered, setHovered] = useState(false);
  const showActions = !isRecalled && (onReply || onRecall || onForward);
  const canRecall = canRecallMessage(message, undefined) && isOwn;

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

  return (
    <div
      className={styles.bubbleWrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Reply preview — show the message being replied to */}
      {replyPreview ? (
        <div className={`${styles.replyPreview} ${isOwn ? styles.replyPreviewOwn : styles.replyPreviewOther}`}>
          <CornerUpLeft size={12} className={styles.replyPreviewIcon} />
          <div className={styles.replyPreviewContent}>
            <span className={styles.replyPreviewSender}>{replyPreview.senderName}</span>
            <span className={styles.replyPreviewText}>
              {replyPreview.content.length > 80
                ? replyPreview.content.slice(0, 80) + '...'
                : replyPreview.content}
            </span>
          </div>
        </div>
      ) : null}

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
        timestamp={formatTime(message.timestamp, t, language)}
        ariaLabel={t('im.message.ariaLabel', { type: senderTypeLabel, name: message.senderName })}
      >
        <MarkdownRenderer content={message.content} />
      </MessageBubble>

      {/* Action buttons — show on hover for non-recalled messages */}
      {showActions && hovered ? (
        <div className={`${styles.actionBar} ${isOwn ? styles.actionBarOwn : styles.actionBarOther}`}>
          {onReply ? (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onReply(message)}
              title="Reply"
              aria-label="Reply"
            >
              <CornerUpLeft size={14} />
            </button>
          ) : null}
          {onForward ? (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onForward(message)}
              title="Forward"
              aria-label="Forward"
            >
              <Forward size={14} />
            </button>
          ) : null}
          {onRecall && canRecall ? (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onRecall(message)}
              title="Recall"
              aria-label="Recall"
            >
              <RotateCcw size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const IMMessageView = memo(function IMMessageView({
  messages,
  currentUserId,
  onReply,
  onRecall,
  onForward,
}: IMMessageViewProps) {
  const { t, i18n } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState
          className={styles.empty ?? ''}
          iconClassName={styles.emptyIcon ?? ''}
          titleClassName={styles.emptyTitle ?? ''}
          descriptionClassName={styles.emptyDescription ?? ''}
          icon={<MessageSquareText size={20} />}
          title={t('im.message.emptyTitle')}
          description={t('im.message.emptyDescription')}
          titleLevel={3}
        />
      </div>
    );
  }

  // Build a lookup of messages by ID for reply previews
  const messageById = new Map<string, IMMessage>();
  for (const msg of messages) {
    if (!messageById.has(msg.id)) messageById.set(msg.id, msg);
  }

  return (
    <div className={styles.root}>
      <div className={styles.stream} role="log" aria-live="polite">
        {messages.map((msg) => {
          const isOwn = currentUserId ? msg.senderId === currentUserId : msg.senderType === 'user';
          const replyPreview = msg.replyToId ? messageById.get(msg.replyToId) : undefined;
          return (
            <div key={msg.id} className={styles.messageItem}>
              <IMMessageBubble
                message={msg}
                isOwn={isOwn}
                t={t}
                language={i18n.resolvedLanguage || i18n.language}
                {...(replyPreview ? { replyPreview } : {})}
                {...(onReply ? { onReply } : {})}
                {...(onRecall ? { onRecall } : {})}
                {...(onForward ? { onForward } : {})}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});

export default IMMessageView;
