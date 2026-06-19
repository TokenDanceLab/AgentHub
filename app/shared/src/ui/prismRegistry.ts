/**
 * Shared Prism language registry.
 *
 * Registers common languages on a single refractor instance and provides
 * low-level highlight helpers used by diff viewers and code previews.
 *
 * react-syntax-highlighter's PrismLight uses the same refractor instance
 * (ESM singleton), so languages registered here are also available to
 * <SyntaxHighlighter> in Markdown.tsx.
 */
import { refractor } from 'refractor/core';

// ── Language grammar imports ──────────────────────────────────────────

import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
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

// ── Register all grammars ──────────────────────────────────────────────

refractor.register(tsx);
refractor.register(typescript);
refractor.register(javascript);
refractor.register(jsx);
refractor.register(bash);
refractor.register(json);
refractor.register(css);
refractor.register(python);
refractor.register(markdown);
refractor.register(diff);
refractor.register(yaml);
refractor.register(rust);
refractor.register(go);
refractor.register(sql);

// ── Aliases ────────────────────────────────────────────────────────────

refractor.alias('js', 'javascript');
refractor.alias('jsx', 'javascript'); // jsx extends javascript grammar
refractor.alias('sh', 'bash');
refractor.alias('shell', 'bash');
refractor.alias('py', 'python');
refractor.alias('md', 'markdown');
refractor.alias('yml', 'yaml');

// ── Extension → language mapping ───────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  pyx: 'python',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  rs: 'rust',
  go: 'go',
  md: 'markdown',
  mdx: 'markdown',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  dockerfile: 'docker',
  env: 'bash',
  gitignore: 'bash',
  editorconfig: 'ini',
  txt: '',
};

/**
 * Detect language from a file path extension.
 * Returns '' for unknown extensions (falls back to plain text).
 */
export function languageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? '';
}

// ── HAST → HTML conversion ─────────────────────────────────────────────

// HAST node shapes (compatible with hast Root/Element/Text from refractor output)
interface HastTextLike {
  type: 'text';
  value: string;
}

interface HastElementLike {
  type: 'element';
  tagName: string;
  properties?: { className?: string[]; [key: string]: unknown };
  children?: Array<HastTextLike | HastElementLike>;
}

type HastNodeLike =
  | HastTextLike
  | HastElementLike
  | { type: 'root'; children?: Array<HastTextLike | HastElementLike> };

function hastToHtml(node: HastNodeLike): string {
  if (node.type === 'text') {
    return escapeHtml((node as HastTextLike).value);
  }
  if (node.type === 'element') {
    const el = node as HastElementLike;
    const classes = el.properties?.className;
    const classAttr =
      classes && classes.length > 0
        ? ` class="${classes.join(' ')}"`
        : '';
    const children = (el.children ?? []).map(hastToHtml).join('');
    if (VOID_ELEMENTS.has(el.tagName)) {
      return `<${el.tagName}${classAttr} />`;
    }
    return `<${el.tagName}${classAttr}>${children}</${el.tagName}>`;
  }
  // type === 'root' or fallback
  if ('children' in node && Array.isArray(node.children)) {
    return (node.children as HastNodeLike[]).map(hastToHtml).join('');
  }
  return '';
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ── HTML escaping (fallback / plain text) ──────────────────────────────

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

// ── Highlight helpers ──────────────────────────────────────────────────

/**
 * Syntax-highlight a single line of code.
 * Returns an HTML string with Prism token spans.
 */
export function highlightLine(code: string, lang: string): string {
  if (!lang || !refractor.registered(lang)) {
    return escapeHtml(code);
  }
  try {
    const tree = refractor.highlight(code, lang);
    return hastToHtml(tree as HastNodeLike);
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Syntax-highlight a block of code, preserving line breaks.
 * Returns an HTML string with Prism token spans and newlines.
 */
export function highlightBlock(code: string, lang: string): string {
  if (!lang || !refractor.registered(lang)) {
    return escapeHtml(code);
  }
  try {
    const lines = code.split('\n');
    return lines
      .map((line) => {
        const tree = refractor.highlight(line, lang);
        return hastToHtml(tree as HastNodeLike);
      })
      .join('\n');
  } catch {
    return escapeHtml(code);
  }
}
