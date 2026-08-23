import React, { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import styles from './MessageBubble.module.css';
import { SkeletonBar } from './SkeletonBar';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

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
  /** Show skeleton placeholder instead of content. */
  isLoading?: boolean;
  /** Shown instead of bubble content when truthy. Takes priority over loading. */
  error?: string | ReactNode;
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
  isLoading,
  error,
}: MessageBubbleProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  if (error) {
    const ContentTag = contentAs;
    return (
      <article className={cx(styles.row, align === 'end' && styles.rowEnd, className)} data-align={align} aria-label={ariaLabel}>
        <div className={cx(styles.bubble, bubbleClassName)}>
          <div className={cx(styles.meta, metaClassName)}>
            <strong className={authorClassName}>{author}</strong>
            <time>{timestamp}</time>
          </div>
          <ContentTag className={cx(styles.content, contentClassName)} role="alert">
            {typeof error === 'string' ? error : error}
          </ContentTag>
        </div>
      </article>
    );
  }

  if (isLoading) {
    return (
      <article className={cx(styles.row, align === 'end' && styles.rowEnd, className)} data-align={align} aria-busy="true" aria-label={t('ui.loading', 'Loading message')}>
        <div className={cx(styles.bubble, bubbleClassName)}>
          <div className={cx(styles.meta, metaClassName)}>
            <strong className={authorClassName}>
              <SkeletonBar width="80px" height="12px" lines={1} />
            </strong>
          </div>
          <div className={cx(styles.content, contentClassName)}>
            <SkeletonBar width="85%" height="12px" lines={3} gap="8px" />
          </div>
        </div>
      </article>
    );
  }

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
