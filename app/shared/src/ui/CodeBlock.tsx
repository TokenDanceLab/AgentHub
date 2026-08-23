import React, { Suspense, lazy, useState, type CSSProperties } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import { useCopiedFlag } from './useCopiedFlag';
import styles from './Markdown.module.css';

/**
 * CodeBlock — fenced-code renderer for the Markdown component.
 *
 * The heavy syntax-highlighter (react-syntax-highlighter + the oneDark theme
 * + the prism language registry) is lazy-loaded so it stays out of the main
 * bundle. A plain `<pre><code>` fallback renders the raw source immediately
 * and is replaced by the highlighted view once the dynamic chunk resolves.
 */

/** Collapsed blocks are clipped to 400px height (see .codeBodyCollapsed in Markdown.module.css). */
const CODE_COLLAPSE_LINE_THRESHOLD = 20;

// ── Lazy syntax highlighter ─────────────────────────────────────────────
// prismRegistry registers languages on the shared refractor instance; it must
// load before the highlighter renders, so it is imported in the same lazy
// factory. All three modules land in one async chunk away from the main bundle.

interface HighlighterProps {
  language: string;
  code: string;
  customStyle?: CSSProperties;
}

const LazyHighlighter = lazy(async (): Promise<{ default: React.FC<HighlighterProps> }> => {
  await import('./prismRegistry');
  const [{ PrismLight: SyntaxHighlighter }, { oneDark }] = await Promise.all([
    import('react-syntax-highlighter'),
    import('react-syntax-highlighter/dist/esm/styles/prism'),
  ]);
  const Highlighter: React.FC<HighlighterProps> = ({ language, code, customStyle }) => (
    <SyntaxHighlighter
      language={language || 'text'}
      PreTag="div"
      style={oneDark}
      customStyle={customStyle}
    >
      {code}
    </SyntaxHighlighter>
  );
  return { default: Highlighter };
});

// ── Fallback shown while the highlighter chunk loads ────────────────────
//
// INTENTIONAL hardcode (see docs/architecture/07-design-system-ssot.md §4):
// these two colors are the oneDark theme binding pair of
// react-syntax-highlighter (background #282c34, base text #abb2bf) — the
// code block renders with oneDark in BOTH app themes, so no theme token
// pair exists or should exist. If the library's oneDark palette changes on
// upgrade, update this block and the Markdown.module.css fade-out gradient
// (same pair) in the same commit.

const fallbackStyle: CSSProperties = {
  margin: 0,
  padding: '12px',
  borderRadius: '0 0 4px 4px',
  fontSize: 12,
  lineHeight: 1.5,
  overflow: 'auto',
  background: '#282c34',
  color: '#abb2bf',
};

function HighlighterFallback({ code }: { code: string }) {
  return (
    <pre style={fallbackStyle}>
      <code>{code}</code>
    </pre>
  );
}

// ── CodeBlock ────────────────────────────────────────────────────────────

export function CodeBlock({
  className,
  children,
}: {
  className?: string | undefined;
  children?: React.ReactNode;
}) {
  // All hooks must run unconditionally: the inline branch below returns
  // early, and a block→inline re-render would otherwise change the hook
  // order ("Rendered fewer hooks than expected").
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);

  const match = /language-(\S+)/.exec(className ?? '');
  const language = match ? match[1] : '';
  const rawCode = String(children ?? '');
  const code = rawCode.replace(/\n$/, '');
  const isLong = code.split('\n').length > CODE_COLLAPSE_LINE_THRESHOLD;
  const [collapsed, setCollapsed] = useState(isLong);
  const [copied, markCopied] = useCopiedFlag();

  // CommonMark block code nodes end with a newline. Inline code spans do not,
  // even when their source crosses a line or their rendered text wraps.
  if (!language && !rawCode.endsWith('\n')) {
    return (
      <code className={styles.inlineCode}>
        {children}
      </code>
    );
  }

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
          aria-label={copied ? t('code.copied') : t('code.copy')}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t('code.copied') : t('code.copy')}
        </button>
      </div>
      <div className={collapsed ? styles.codeBodyCollapsed : undefined}>
        <Suspense fallback={<HighlighterFallback code={code} />}>
          <LazyHighlighter
            language={language || 'text'}
            code={code}
            customStyle={{
              margin: 0,
              borderRadius: '0 0 4px 4px',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          />
        </Suspense>
      </div>
      {isLong && (
        <button
          type="button"
          className={styles.codeToggle}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? t('code.expand') : t('code.collapse')}
        </button>
      )}
    </div>
  );
}
