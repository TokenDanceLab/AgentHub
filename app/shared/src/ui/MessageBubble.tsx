import React, { type ReactNode } from 'react';
import styles from './MessageBubble.module.css';

export interface MessageBubbleProps {
  author: ReactNode;
  timestamp: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  contentAs?: 'p' | 'div';
  ariaLabel?: string;
  actions?: ReactNode;
  className?: string | undefined;
  bubbleClassName?: string | undefined;
  metaClassName?: string | undefined;
  authorClassName?: string | undefined;
  contentClassName?: string | undefined;
  actionsClassName?: string | undefined;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function MessageBubble({
  author,
  timestamp,
  children,
  align = 'start',
  contentAs = 'p',
  ariaLabel,
  actions,
  className,
  bubbleClassName,
  metaClassName,
  authorClassName,
  contentClassName,
  actionsClassName,
}: MessageBubbleProps) {
  const ContentTag = contentAs;

  return (
    <article className={cx(styles.row, align === 'end' && styles.rowEnd, className)} data-align={align} aria-label={ariaLabel}>
      <div className={cx(styles.bubble, bubbleClassName)}>
        <div className={cx(styles.meta, metaClassName)}>
          <strong className={authorClassName}>{author}</strong>
          <time>{timestamp}</time>
          {actions ? <span className={cx(styles.actions, actionsClassName)}>{actions}</span> : null}
        </div>
        <ContentTag className={cx(styles.content, contentClassName)}>{children}</ContentTag>
      </div>
    </article>
  );
}
