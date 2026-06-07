import React, { useState } from 'react';
import styles from './ThinkingBlock.module.css';

interface ThinkingBlockProps {
  content?: string | undefined;
  isThinking?: boolean | undefined;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  isThinking = false,
}) => {
  const [open, setOpen] = useState(isThinking);
  const status = isThinking ? '运行中' : '完成';

  return (
    <div className={styles.row}>
      <section className={[
        styles.step,
        'thinking-block',
        isThinking ? styles.running : styles.completed,
        open ? styles.open : '',
      ].filter(Boolean).join(' ')} data-card-surface>
        <button
          aria-expanded={open}
          className={styles.toggle}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span className={styles.icon}>T</span>
          <span className={styles.copy}>
            <strong>{isThinking ? '深度思考' : '思考完成'}</strong>
            <small>{isThinking ? '正在分析 schema 边界和回滚风险' : '推理内容已折叠'}</small>
          </span>
          <span className={styles.status}>{status}</span>
          <span className={styles.chevron} aria-hidden="true">⌄</span>
        </button>
        <div className={styles.detail}>
          <div className={styles.detailInner}>
            <div className={styles.detailBlock}>
              <div className={styles.detailHead}>
                <strong>{isThinking ? '当前推理' : '推理摘要'}</strong>
                <em>{status}</em>
              </div>
              {content && <p>{content}</p>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
