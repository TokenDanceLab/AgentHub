import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, MessageBlock } from './ChatView.types';
import styles from './ChatView.module.css';

interface Props {
  messages: ChatMessage[];
  isStreaming?: boolean;
}

export type { ChatMessage, MessageBlock };

function BlockRenderer({ block, t }: { block: MessageBlock; t: (key: string, vars?: Record<string, unknown>) => string }) {
  switch (block.kind) {
    case 'text':
      return <div className={styles.text}>{block.content}</div>;

    case 'code':
      return (
        <pre className={styles.codeBlock}>
          {block.language && <span className={styles.codeLang}>{block.language}</span>}
          <code>{block.content}</code>
        </pre>
      );

    case 'thinking':
      return (
        <details className={styles.thinking}>
          <summary>{t('chat.thinking')}</summary>
          <div className={styles.thinkingContent}>{block.content}</div>
        </details>
      );

    case 'tool_call':
      return (
        <details className={styles.toolCard}>
          <summary>
            <span className={styles.toolLabel}>{t('chat.toolCall', { name: block.toolName })}</span>
            <span className={`${styles.toolStatus} ${block.status === 'completed' ? styles.toolDone : ''}`}>
              {block.status}
            </span>
          </summary>
          <pre className={styles.toolInput}>
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </details>
      );

    case 'tool_result':
      return (
        <details className={styles.toolCard}>
          <summary>{t('chat.toolCall', { name: block.toolName })} — result</summary>
          <pre className={styles.toolOutput}>{block.output}</pre>
        </details>
      );

    case 'file_change': {
      const actionClass =
        block.action === 'created' ? styles.added : block.action === 'deleted' ? styles.removed : styles.modified;
      return (
        <details className={`${styles.fileCard} ${actionClass}`}>
          <summary>{t('chat.fileChange', { path: block.path })}</summary>
          {block.diff && <pre className={styles.diff}>{block.diff}</pre>}
        </details>
      );
    }

    case 'session_init':
      return (
        <div className={styles.sessionInit}>
          {t('chat.sessionInit', { model: block.model ?? 'unknown' })}
          {block.permissionMode && <span className={styles.permBadge}>{block.permissionMode}</span>}
        </div>
      );

    case 'result': {
      const cls = block.success ? styles.resultSuccess : styles.resultFailed;
      const msg = block.success
        ? t('chat.result.success', {
            input: block.tokenUsage?.input ?? '?',
            output: block.tokenUsage?.output ?? '?',
          })
        : t('chat.result.failed', { error: block.error ?? 'unknown error' });
      return <div className={`${styles.result} ${cls}`}>{msg}</div>;
    }

    default:
      return null;
  }
}

export default function ChatView({ messages, isStreaming }: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.stream}>
        {messages.length === 0 ? (
          <div className={styles.empty}>{t('chat.empty')}</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.message} ${msg.role === 'user' ? styles.userMsg : msg.role === 'system' ? styles.systemMsg : styles.agentMsg}`}
            >
              {msg.blocks.map((block, i) => (
                <BlockRenderer key={i} block={block} t={t} />
              ))}
            </div>
          ))
        )}
        {isStreaming && <div className={styles.cursor} />}
      </div>
    </div>
  );
}
