/**
 * Per-line syntax highlighting for diff viewers.
 * Uses PrismJS for tokenization and outputs HTML with token CSS classes.
 */
import Prism from 'prismjs';

// Register common languages (tree-shakeable: only used languages are loaded)
// IMPORTANT: imports must be in dependency order:
//   tsx → typescript → jsx → javascript
//   markdown → javascript
//   scss → css
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';

// ── Extension → Prism language mapping ───────────────────────────────────

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
 * Detect Prism language from a file path.
 * Returns '' for unknown extensions (falls back to plain text, no highlighting).
 */
export function languageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? '';
}

/**
 * Syntax-highlight a single line of code.
 * Returns an HTML string with Prism token spans.
 * When lang is '' or unknown, returns the HTML-escaped plain text.
 */
export function highlightLine(code: string, lang: string): string {
  const grammar = lang ? Prism.languages[lang] : undefined;
  if (!grammar) {
    return escapeHtml(code);
  }
  try {
    return Prism.highlight(code, grammar, lang);
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Syntax-highlight a block of code.
 * Returns an HTML string with Prism token spans and newlines preserved.
 */
export function highlightBlock(code: string, lang: string): string {
  const grammar = lang ? Prism.languages[lang] : undefined;
  if (!grammar) {
    return escapeHtml(code);
  }
  try {
    const lines = code.split('\n');
    return lines
      .map((line) => Prism.highlight(line, grammar, lang))
      .join('\n');
  } catch {
    return escapeHtml(code);
  }
}

// ── HTML escaping (for fallback when no language is detected) ────────────

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
