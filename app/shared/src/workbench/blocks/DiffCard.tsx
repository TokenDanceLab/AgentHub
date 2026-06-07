import React from 'react';
import { DesignFileIcon } from '../designIcons';
import styles from './DiffCard.module.css';

interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  content: string;
}

interface DiffCardProps {
  filename: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

const lineClassMap: Record<DiffLine['type'], string> = {
  add: styles.add ?? '',
  del: styles.del ?? '',
  ctx: styles.ctx ?? '',
};

export const DiffCard: React.FC<DiffCardProps> = ({
  filename,
  additions,
  deletions,
  lines,
}) => {
  return (
    <div className={styles.card} data-card-surface>
      <div className={styles.header}>
        <DesignFileIcon className={styles.fileIcon} name={filename} />
        <span className={styles.filename}>{filename}</span>
        <span className={styles.stat}>
          +{additions} -{deletions}
        </span>
      </div>
      {lines.map((line, i) => (
        <div key={i} className={`${styles.line} ${lineClassMap[line.type]}`}>
          {line.content}
        </div>
      ))}
    </div>
  );
};
