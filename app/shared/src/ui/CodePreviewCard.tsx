import React, { type ReactNode } from 'react';
import styles from './CodePreviewCard.module.css';

export interface CodePreviewCardProps {
  title: ReactNode;
  code: string;
  meta?: ReactNode;
  actions?: ReactNode;
  maxLines?: number;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  metaClassName?: string;
  bodyClassName?: string;
  lineClassName?: string;
  actionsClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function CodePreviewCard({
  title,
  code,
  meta,
  actions,
  maxLines,
  className,
  headerClassName,
  titleClassName,
  metaClassName,
  bodyClassName,
  lineClassName,
  actionsClassName,
}: CodePreviewCardProps) {
  const lines = code.split(/\r?\n/);
  const visibleLines = maxLines != null ? lines.slice(0, maxLines) : lines;
  const hiddenLineCount = maxLines != null ? Math.max(lines.length - maxLines, 0) : 0;

  return (
    <article className={cx(styles.card, className)} data-has-actions={actions ? 'true' : undefined}>
      <header className={cx(styles.header, headerClassName)}>
        <span className={cx(styles.title, titleClassName)}>{title}</span>
        {meta ? <span className={cx(styles.meta, metaClassName)}>{meta}</span> : null}
        {actions ? <span className={cx(styles.actions, actionsClassName)}>{actions}</span> : null}
      </header>
      <code className={cx(styles.body, bodyClassName)}>
        {visibleLines.map((line, index) => (
          <span key={`${index}-${line}`} className={cx(styles.line, lineClassName)}>
            {line || ' '}
          </span>
        ))}
        {hiddenLineCount > 0 ? (
          <span className={cx(styles.more, lineClassName)}>+{hiddenLineCount} more lines</span>
        ) : null}
      </code>
    </article>
  );
}
