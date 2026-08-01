/**
 * Per-line syntax highlighting for diff viewers.
 *
 * Delegates to the shared prismRegistry — all language grammars are
 * registered once and shared with react-syntax-highlighter (Markdown.tsx).
 */
export {
  highlightLine,
  highlightBlock,
  highlightLineWithWordDiff,
  languageFromPath,
} from './prismRegistry';
