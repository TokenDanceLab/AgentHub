import React, { memo, type HTMLAttributes } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkGfm from 'remark-gfm';
import remarkCjkAutolink from './cjkRemarkPlugin';
import rehypeSlug from 'rehype-slug';
import { Link2 } from 'lucide-react';
import { CodeBlock } from './CodeBlock';
import styles from './Markdown.module.css';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

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
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const anchorId = id && id.length > 0 ? id : undefined;
  const Tag = tag;
  return (
    <Tag {...(anchorId ? { id: anchorId } : {})} {...rest}>
      {anchorId ? (
        <a href={`#${anchorId}`} className={styles.headingAnchor} aria-label={t('aria.jumpToHeading')}>
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
