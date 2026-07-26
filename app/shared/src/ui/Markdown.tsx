import React, { memo } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkGfm from 'remark-gfm';
import remarkCjkAutolink from './cjkRemarkPlugin';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import './prismRegistry'; // registers all languages on shared refractor instance
import styles from './Markdown.module.css';

// ── CodeBlock component ───────────────────────────
function CodeBlock({
  className,
  children,
  ...rest
}: {
  className?: string | undefined;
  children?: React.ReactNode;
}) {
  const match = /language-(\S+)/.exec(className ?? '');
  const language = match ? match[1] : '';
  const rawCode = String(children ?? '');

  // CommonMark block code nodes end with a newline. Inline code spans do not,
  // even when their source crosses a line or their rendered text wraps.
  if (!language && !rawCode.endsWith('\n')) {
    return (
      <code className={styles.inlineCode} {...rest}>
        {children}
      </code>
    );
  }

  const code = rawCode.replace(/\n$/, '');

  return (
    <div className={styles.codeBlockWrapper}>
      {language && <span className={styles.codeLang}>{language}</span>}
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: language ? '0 0 4px 4px' : 4,
          fontSize: 12,
          lineHeight: 1.5,
        }}
        {...rest}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

// ── Custom component map ──────────────────────────
const components: Components = {
  code: CodeBlock,
};

/* ── Exported component ───────────────────────────── */

export interface MarkdownContentProps {
  content: string;
}

function MarkdownContent({ content }: MarkdownContentProps) {
  if (!content) return null;
  return (
    <div className={styles.root}>
      <Markdown
        components={components}
        remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkCjkAutolink]}
      >
        {content}
      </Markdown>
    </div>
  );
}

export default memo(MarkdownContent);
