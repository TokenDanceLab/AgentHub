import React, { memo, useState, type HTMLAttributes } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkGfm from 'remark-gfm';
import remarkCjkAutolink from './cjkRemarkPlugin';
import rehypeSlug from 'rehype-slug';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy, Link2 } from 'lucide-react';
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

// ── Heading anchor links (#1506) ──────────────────
// `rehype-slug` assigns each h1-h6 a stable `id` (GitHub-style slug; keeps
// CJK characters, appends -1/-2 to duplicates). The heading component then
// renders a hover-revealed link icon that jumps to that anchor — same
// interaction as docs sites, no new layout or portal needed.

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

function HeadingWithAnchor({
  tag,
  id,
  node: _node,
  children,
  ...rest
}: { tag: HeadingTag; id?: string | undefined; node?: unknown } & HTMLAttributes<HTMLHeadingElement>) {
  const anchorId = id && id.length > 0 ? id : undefined;
  const Tag = tag;
  return (
    <Tag {...(anchorId ? { id: anchorId } : {})} {...rest}>
      {anchorId ? (
        <a href={`#${anchorId}`} className={styles.headingAnchor} aria-label="跳转到标题">
          <Link2 size={12} aria-hidden />
        </a>
      ) : null}
      {children}
    </Tag>
  );
}

// ── Custom component map ──────────────────────────
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
  h1: (props) => <HeadingWithAnchor tag="h1" {...props} />,
  h2: (props) => <HeadingWithAnchor tag="h2" {...props} />,
  h3: (props) => <HeadingWithAnchor tag="h3" {...props} />,
  h4: (props) => <HeadingWithAnchor tag="h4" {...props} />,
  h5: (props) => <HeadingWithAnchor tag="h5" {...props} />,
  h6: (props) => <HeadingWithAnchor tag="h6" {...props} />,
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
        rehypePlugins={[rehypeSlug]}
      >
        {content}
      </Markdown>
    </div>
  );
}

export default memo(MarkdownContent);
