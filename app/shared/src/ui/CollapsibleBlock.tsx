import React, { useState, useCallback, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './CollapsibleBlock.module.css';

type ColorScheme = 'default' | 'blue' | 'green' | 'amber' | 'purple' | 'red';

interface CollapsibleBlockProps {
  /** Header label shown when collapsed */
  label: string;
  /** Optional badge text (e.g. tool name) */
  badge?: string;
  /** Icon name (Material Symbols) */
  icon?: string;
  /** Color scheme for the header */
  colorScheme?: ColorScheme;
  /** Preview content shown when collapsed */
  preview?: string;
  /** Max lines of preview before truncation */
  maxPreviewLines?: number;
  /** Start in expanded state */
  defaultExpanded?: boolean;
  /** Content revealed when expanded */
  children: ReactNode;
}

function schemeClass(s: ColorScheme): string {
  switch (s) {
    case 'default': return styles.schemeDefault!;
    case 'blue': return styles.schemeBlue!;
    case 'green': return styles.schemeGreen!;
    case 'amber': return styles.schemeAmber!;
    case 'purple': return styles.schemePurple!;
    case 'red': return styles.schemeRed!;
  }
}

export function CollapsibleBlock({
  label,
  badge,
  icon,
  colorScheme = 'default',
  preview,
  maxPreviewLines = 5,
  defaultExpanded = false,
  children,
}: CollapsibleBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const previewLines = preview?.split('\n') ?? [];
  const hasMoreLines = previewLines.length > maxPreviewLines;

  return (
    <div className={`${styles.block} ${schemeClass(colorScheme)} ${expanded ? styles.expanded : ''}`}>
      <button
        type="button"
        className={styles.header}
        onClick={toggle}
        aria-expanded={expanded}
      >
        <span className={styles.headerLeft}>
          {icon && <Icon name={icon} size={16} />}
          <span className={styles.label}>{label}</span>
          {badge && <span className={styles.badge}>{badge}</span>}
        </span>
        <Icon name={expanded ? 'expand_less' : 'expand_more'} size={18} />
      </button>

      {!expanded && preview ? (
        <div className={styles.preview}>
          {previewLines.slice(0, maxPreviewLines).map((line, i) => (
            <span key={i} className={styles.previewLine}>{line}</span>
          ))}
          {hasMoreLines && (
            <span className={styles.previewMore}>+{previewLines.length - maxPreviewLines} more lines</span>
          )}
        </div>
      ) : null}

      {expanded && <div className={styles.content}>{children}</div>}
    </div>
  );
}
