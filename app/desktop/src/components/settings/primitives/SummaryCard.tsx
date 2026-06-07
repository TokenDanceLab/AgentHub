import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import styles from './primitives.module.css';

interface SummaryCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  expandedDetail?: ReactNode;
  expandedDetailPlacement?: 'below' | 'detail';
  expandLabel?: string;
  collapseLabel?: string;
}

export default function SummaryCard({
  icon,
  label,
  value,
  detail,
  expandedDetail,
  expandedDetailPlacement = 'below',
  expandLabel,
  collapseLabel,
}: SummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const expandedId = useId();
  const canExpand = Boolean(expandedDetail);
  const showInlineExpandedDetail = canExpand && expanded && expandedDetailPlacement === 'detail';
  const expandButtonLabel = expanded
    ? collapseLabel ?? label
    : expandLabel ?? label;

  return (
    <div className={`${styles.summaryCard} ${canExpand ? styles.summaryCardExpandable : ''}`}>
      <div className={styles.summaryIcon}>{icon}</div>
      <div className={styles.summaryContent}>
        <span>{label}</span>
        <strong>{value}</strong>
        {showInlineExpandedDetail ? (
          <div id={expandedId} className={styles.summaryInlineExpandedDetail}>
            {expandedDetail}
          </div>
        ) : (
          <small id={canExpand && expandedDetailPlacement === 'detail' ? expandedId : undefined}>{detail}</small>
        )}
      </div>
      {canExpand && (
        <button
          type="button"
          className={styles.summaryExpandBtn}
          aria-label={expandButtonLabel}
          aria-expanded={expanded}
          aria-controls={expandedId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      )}
      {canExpand && expanded && expandedDetailPlacement === 'below' && (
        <div id={expandedId} className={styles.summaryExpandedDetail}>
          {expandedDetail}
        </div>
      )}
    </div>
  );
}
