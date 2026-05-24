import { useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  content: string;
  language?: string;
}

export default function CodeBlock({ content, language }: CodeBlockProps) {
  const [highlighted, setHighlighted] = useState(false);
  const [copied, setCopied] = useState(false);

  // Show plain text on first paint, then highlight on next frame
  useEffect(() => {
    const id = requestAnimationFrame(() => setHighlighted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may not be available (e.g. non-HTTPS)
    }
  }, [content]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        {language && <span className={styles.lang}>{language}</span>}
        <button
          className={styles.copyBtn}
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy code'}
          aria-label={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      {highlighted ? (
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
        >
          {content}
        </SyntaxHighlighter>
      ) : (
        <pre className={styles.plain}>
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}
