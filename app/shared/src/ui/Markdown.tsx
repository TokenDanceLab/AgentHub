import React, { memo, useState } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkGfm from 'remark-gfm';
import remarkCjkAutolink from './cjkRemarkPlugin';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';
import './prismRegistry'; // registers all languages on shared refractor instance
import { useCopiedFlag } from './useCopiedFlag';
import styles from './Markdown.module.css';

/** Collapsed blocks are clipped to 400px height (see .codeBodyCollapsed in Markdown.module.css). */
const CODE_COLLAPSE_LINE_THRESHOLD = 20;

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
  const isLong = code.split('\n').length > CODE_COLLAPSE_LINE_THRESHOLD;
  const [collapsed, setCollapsed] = useState(isLong);
  const [copied, markCopied] = useCopiedFlag();

  const handleCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(code).then(markCopied).catch(() => {
      /* clipboard may be denied — keep silent, no feedback flip */
    });
  };

  return (
    <div className={styles.codeBlockWrapper}>
      <div className={styles.codeBlockHeader}>
        {language && <span className={styles.codeLang}>{language}</span>}
        <button
          type="button"
          className={`${styles.codeCopyBtn}${copied ? ' ' + styles.copied : ''}`}
          onClick={handleCopy}
          aria-label={copied ? '已复制' : '复制'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className={collapsed ? styles.codeBodyCollapsed : undefined}>
        <SyntaxHighlighter
          style={oneDark}
          language={language || 'text'}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: '0 0 4px 4px',
            fontSize: 12,
            lineHeight: 1.5,
          }}
          {...rest}
        >
          {code}
        </SyntaxHighlighter>
      </div>
      {isLong && (
        <button
          type="button"
          className={styles.codeToggle}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      )}
    </div>
  );
}

// ── Custom component map ──────────────────────────
/* TODO(codeg parity #8): heading anchor links (rehype-slug +
   rehype-autolink-headings) need new dependencies — skipped deliberately. */
const components: Components = {
  code: CodeBlock,
  // Lazy-load markdown images; they are often large and below the fold.
  img: ({ node: _node, ...props }) => <img {...props} loading="lazy" />,
  // Open external links in a new tab with noopener; in-page anchors (#…)
  // keep navigating within the same window (e.g. GFM footnote backrefs).
  a: ({ node: _node, ...props }) =>
    typeof props.href === 'string' && props.href.startsWith('#') ? (
      <a {...props} />
    ) : (
      <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
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
