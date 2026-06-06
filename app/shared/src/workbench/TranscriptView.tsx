import React from 'react';
import type { TranscriptBlock } from '../transcript';
import styles from './AgentHubWorkbench.module.css';

export interface TranscriptViewProps {
  transcript: TranscriptBlock[];
}

export function TranscriptView({ transcript }: TranscriptViewProps): React.ReactElement {
  return (
    <section aria-label="Transcript" className={styles.transcriptRegion}>
      <ol className={styles.transcript}>
        {transcript.map((block) => (
          <li className={styles.block} key={block.id}>
            <span className={styles.blockAuthor}>{block.author.name}</span>
            {renderTranscriptBlock(block)}
          </li>
        ))}
      </ol>
    </section>
  );
}

function renderTranscriptBlock(block: TranscriptBlock): React.ReactElement {
  switch (block.kind) {
    case 'text':
      return <p className={styles.blockText}>{block.text}</p>;
    case 'tool_call':
      return (
        <p className={styles.blockTitle}>
          {block.toolName}
          <span className={styles.blockMeta}> · {block.status}</span>
        </p>
      );
    case 'artifact':
    case 'diff':
    case 'approval':
      return <p className={styles.blockTitle}>{block.title}</p>;
  }
}
