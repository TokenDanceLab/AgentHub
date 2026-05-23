import { memo } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import styles from './MarkdownRenderer.module.css';

// ── Register common languages (light build) ────────
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('diff', diff);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('sql', sql);

// ── CodeBlock component ───────────────────────────
function CodeBlock({
  className,
  children,
  ...rest
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const match = /language-(\S+)/.exec(className ?? '');
  const language = match ? match[1] : '';
  const code = String(children ?? '').replace(/\n$/, '');

  // Inline code: short single-line without language prefix
  if (!language && !code.includes('\n') && code.length < 80) {
    return (
      <code className={styles.inlineCode} {...rest}>
        {children}
      </code>
    );
  }

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
  code: CodeBlock as Components['code'],
};

interface MarkdownRendererProps {
  content: string;
}

function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className={styles.root}>
      <Markdown components={components}>{content}</Markdown>
    </div>
  );
}

export default memo(MarkdownRenderer);
