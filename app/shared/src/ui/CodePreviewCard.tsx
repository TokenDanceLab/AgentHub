import React, { type ReactNode } from 'react';
import styles from './CodePreviewCard.module.css';
import { SkeletonBar } from './SkeletonBar';

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
  /** Show skeleton placeholder instead of code. */
  isLoading?: boolean;
  /** Number of skeleton code lines to render in loading state. Default 8. */
  loadingRows?: number;
  /** Shown when code is empty and not loading or erring. */
  emptyState?: ReactNode;
  /** Shown instead of card content when truthy. Takes priority over loading/empty. */
  error?: string | ReactNode;
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
  isLoading,
  loadingRows,
  emptyState,
  error,
}: CodePreviewCardProps) {
  return (
    <article className={cx(styles.card, className)} data-has-actions={actions ? 'true' : undefined}>
      <header className={cx(styles.header, headerClassName)}>
        <span className={cx(styles.title, titleClassName)}>{title}</span>
        {meta ? <span className={cx(styles.meta, metaClassName)}>{meta}</span> : null}
        {actions ? <span className={cx(styles.actions, actionsClassName)}>{actions}</span> : null}
      </header>
      {error ? (
        <code className={cx(styles.body, bodyClassName)} role="alert">
          <span className={cx(styles.line, lineClassName)}>
            {typeof error === 'string' ? error : error}
          </span>
        </code>
      ) : isLoading ? (
        <code className={cx(styles.body, bodyClassName)} aria-busy="true">
          {Array.from({ length: loadingRows ?? 8 }, (_, i) => (
            <span key={i} className={cx(styles.line, lineClassName)}>
              <SkeletonBar width={`${40 + Math.floor(Math.random() * 55)}%`} height="12px" lines={1} />
            </span>
          ))}
        </code>
      ) : code === '' && emptyState !== undefined ? (
        <code className={cx(styles.body, bodyClassName)}>
          <span className={cx(styles.line, lineClassName)}>{emptyState}</span>
        </code>
      ) : (
        <CodeLines
          code={code}
          maxLines={maxLines}
          bodyClassName={bodyClassName}
          lineClassName={lineClassName}
        />
      )}
    </article>
  );
}

function CodeLines({
  code,
  maxLines,
  bodyClassName,
  lineClassName,
}: {
  code: string;
  maxLines: number | undefined;
  bodyClassName: string | undefined;
  lineClassName: string | undefined;
}) {
  const lines = code.split(/\r?\n/);
  const visibleLines = maxLines != null ? lines.slice(0, maxLines) : lines;
  const hiddenLineCount = maxLines != null ? Math.max(lines.length - maxLines, 0) : 0;

  return (
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
  );
}
