import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, File, FolderOpen, FileSearch, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import styles from './FileSearchDialog.module.css';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

interface ContentMatch {
  file_path: string;
  file_name: string;
  match_count: number;
  first_match_line: number;
  first_match_preview: string;
}

interface FileResult {
  kind: 'file';
  name: string;
  path: string;
  relPath: string;
  isDir: boolean;
  score: number;
  matchPositions: number[];
}

interface ContentResult {
  kind: 'content';
  file_path: string;
  file_name: string;
  match_count: number;
  first_match_line: number;
  first_match_preview: string;
}

type UnifiedFileResult = FileResult | ContentResult;

interface Props {
  workspaceDir: string | undefined;
  onSelectFile: (filePath: string) => void;
  onOpenInVSCode: (filePath: string) => void;
  open: boolean;
  onClose: () => void;
}

// ── Fuzzy matcher ────────────────────────────

/**
 * Simple fuzzy matching that scores a candidate string against a query.
 * Returns { score, positions } where score >= 0 means matched, -1 means no match.
 * Preference: contiguous matches > separated matches, earlier positions > later,
 * word-boundary matches (after /, -, _, . or uppercase start) get bonus.
 */
function fuzzyScore(candidate: string, query: string): { score: number; positions: number[] } {
  const cLower = candidate.toLowerCase();
  const qLower = query.toLowerCase();
  const positions: number[] = [];
  const clen = cLower.length;
  const qlen = qLower.length;

  if (qlen === 0) return { score: 0, positions: [] };
  if (clen === 0) return { score: -1, positions: [] };

  let qi = 0;
  let ci = 0;
  let score = 0;
  let consecutiveBonus = 0;
  let prevCi = -2;

  while (qi < qlen && ci < clen) {
    if (cLower[ci] === qLower[qi]) {
      positions.push(ci);
      score += (clen - ci) * 10;
      if (ci === 0 || isWordBoundary(candidate, ci)) {
        score += 50;
      }
      if (prevCi === ci - 1) {
        consecutiveBonus += 30;
        score += consecutiveBonus;
      } else {
        consecutiveBonus = 0;
      }
      prevCi = ci;
      qi++;
      ci++;
    } else {
      ci++;
    }
  }

  if (qi < qlen) return { score: -1, positions: [] };

  if (positions.length > 1) {
    const last = positions[positions.length - 1]!;
    const first = positions[0]!;
    const totalGap = last - first - (positions.length - 1);
    score -= totalGap * 2;
  }

  return { score, positions };
}

function isWordBoundary(s: string, idx: number): boolean {
  if (idx === 0) return true;
  const prev = s[idx - 1]!;
  return prev === '/' || prev === '\\' || prev === '-' || prev === '_' || prev === '.' ||
    (prev >= 'a' && prev <= 'z' && s[idx]! >= 'A' && s[idx]! <= 'Z');
}

// ── Flatten file tree ───────────────────────

function flattenTree(entries: FileEntry[], prefix = ''): { name: string; path: string; isDir: boolean; relPath: string }[] {
  const result: { name: string; path: string; isDir: boolean; relPath: string }[] = [];
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    result.push({ name: entry.name, path: entry.path, isDir: entry.is_dir, relPath });
    if (entry.is_dir && entry.children) {
      result.push(...flattenTree(entry.children, relPath));
    }
  }
  return result;
}

// ── Highlight text with matched positions ─────

function HighlightText({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const posSet = new Set(positions);
  const spans: (string | React.ReactElement)[] = [];
  let lastIdx = 0;

  for (let i = 0; i < text.length; i++) {
    if (posSet.has(i) && (i === 0 || !posSet.has(i - 1))) {
      if (i > lastIdx) {
        spans.push(text.slice(lastIdx, i));
      }
      let j = i;
      while (j < text.length && posSet.has(j)) j++;
      spans.push(
        <span key={i} className={styles.highlight}>{text.slice(i, j)}</span>,
      );
      lastIdx = j;
      i = j - 1;
    }
  }
  if (lastIdx < text.length) {
    spans.push(text.slice(lastIdx));
  }
  return <>{spans}</>;
}

// ── Component ────────────────────────────────

export default function FileSearchDialog({ workspaceDir, onSelectFile, onOpenInVSCode, open, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [contentResults, setContentResults] = useState<ContentMatch[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [mode, setMode] = useState<'file' | 'content'>('file');
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load directory tree when workspace changes
  useEffect(() => {
    if (!workspaceDir) {
      setFileTree([]);
      setTreeLoaded(false);
      return;
    }
    setTreeLoading(true);
    invoke<FileEntry[]>('read_dir_tree', { dir: workspaceDir })
      .then((tree) => {
        setFileTree(tree);
        setTreeLoaded(true);
      })
      .catch((err) => {
        console.error('[FileSearch] Failed to load directory tree:', err);
        setFileTree([]);
        setTreeLoaded(true);
      })
      .finally(() => setTreeLoading(false));
  }, [workspaceDir]);

  // Auto-focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setQuery('');
      setSelectedIndex(0);
      setContentResults([]);
      setMode('file');
    }
  }, [open]);

  // Flatten file tree into searchable list
  const flatFiles = useMemo(() => flattenTree(fileTree), [fileTree]);

  // Fuzzy file search results
  const fileResults: FileResult[] = useMemo(() => {
    if (!query.trim() || mode !== 'file') return [];
    const q = query.trim();
    const scored = flatFiles
      .map((f) => {
        const { score, positions } = fuzzyScore(f.relPath, q);
        return { ...f, score, matchPositions: positions };
      })
      .filter((f) => f.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((f) => ({
        kind: 'file' as const,
        name: f.name,
        path: f.path,
        relPath: f.relPath,
        isDir: f.isDir,
        score: f.score,
        matchPositions: f.matchPositions,
      }));
    return scored;
  }, [flatFiles, query, mode]);

  // Content search via Tauri command
  useEffect(() => {
    if (mode !== 'content' || !query.trim() || !workspaceDir) {
      setContentResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setContentLoading(true);
    debounceRef.current = setTimeout(() => {
      invoke<ContentMatch[]>('search_workspace_content', { dir: workspaceDir, query: query.trim() })
        .then((results) => setContentResults(results))
        .catch((err) => {
          console.error('[FileSearch] Content search failed:', err);
          setContentResults([]);
        })
        .finally(() => setContentLoading(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode, workspaceDir]);

  const contentResultItems: ContentResult[] = useMemo(() => {
    return contentResults.map((m) => ({
      kind: 'content' as const,
      ...m,
    }));
  }, [contentResults]);

  // Unified results
  const results: UnifiedFileResult[] = useMemo(() => {
    if (mode === 'content') return contentResultItems.slice(0, 50);
    return fileResults;
  }, [mode, fileResults, contentResultItems]);

  const isLoading = treeLoading || (mode === 'content' && contentLoading);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
      if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        const result = results[selectedIndex];
        const filePath = result.kind === 'file' ? result.path : result.file_path;
        if (e.ctrlKey || e.metaKey) {
          onOpenInVSCode(filePath);
        } else {
          onSelectFile(filePath);
        }
        onClose();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [results, selectedIndex, onClose, onSelectFile, onOpenInVSCode],
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('fileSearch.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.inputRow}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label={t('fileSearch.title')}
            aria-controls="file-search-results"
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              !workspaceDir
                ? t('fileSearch.noWorkspace')
                : mode === 'content'
                  ? t('fileSearch.contentPlaceholder')
                  : t('fileSearch.placeholder')
            }
            autoFocus
            disabled={!workspaceDir}
          />
          <kbd className={styles.kbd}>ESC</kbd>
        </div>

        {/* Mode tabs */}
        {workspaceDir && (
          <div className={styles.modeRow}>
            <button
              type="button"
              className={`${styles.modeTab} ${mode === 'file' ? styles.modeTabActive : ''}`}
              onClick={() => { setMode('file'); setContentResults([]); }}
            >
              <FileSearch size={13} />
              {t('fileSearch.resultFiles')}
            </button>
            <button
              type="button"
              className={`${styles.modeTab} ${mode === 'content' ? styles.modeTabActive : ''}`}
              onClick={() => { setMode('content'); }}
            >
              <Search size={13} />
              {t('fileSearch.resultContent')}
            </button>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && !isLoading && (
          <div id="file-search-results" className={styles.results} ref={resultsRef} role="listbox" aria-label={t('fileSearch.title')}>
            {results.map((result, i) => (
              <div
                key={result.kind === 'file' ? `file:${result.path}` : `content:${result.file_path}`}
                role="option"
                aria-selected={i === selectedIndex}
                data-index={i}
                className={`${styles.item} ${i === selectedIndex ? styles.selected : ''}`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => {
                  const fp = result.kind === 'file' ? result.path : result.file_path;
                  onSelectFile(fp);
                  onClose();
                }}
              >
                <span className={styles.itemIcon}>
                  {result.kind === 'file' && result.isDir
                    ? <FolderOpen size={14} />
                    : <File size={14} />}
                </span>
                <div className={styles.itemContent}>
                  <span className={styles.itemPrimary}>
                    {result.kind === 'file'
                      ? <HighlightText text={result.name} positions={result.matchPositions} />
                      : result.file_name}
                  </span>
                  {result.kind === 'file' ? (
                    <span className={styles.itemPath}>{result.path}</span>
                  ) : (
                    <span className={styles.itemSecondary}>
                      {t('fileSearch.matches', { count: result.match_count })}
                      {' - L'}
                      {result.first_match_line}
                      {': '}
                      {result.first_match_preview}
                    </span>
                  )}
                </div>
                {result.kind === 'content' && (
                  <div className={styles.itemMeta}>
                    <span className={styles.matchCount}>
                      {t('fileSearch.matches', { count: result.match_count })}
                    </span>
                    <span className={styles.matchLine}>L{result.first_match_line}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className={styles.loading}>
            <Loader2 size={14} className={styles.spinner} />
            {t('settings.loading')}
          </div>
        )}

        {/* No results */}
        {query.trim() && results.length === 0 && !isLoading && (
          <div className={styles.empty}>
            {t('fileSearch.empty')}
            {mode === 'file' && (
              <span className={styles.emptyHint}>
                {t('fileSearch.enterHint')} / {t('fileSearch.ctrlEnterHint')}
              </span>
            )}
          </div>
        )}

        {/* No workspace */}
        {!workspaceDir && (
          <div className={styles.empty}>{t('fileSearch.noWorkspace')}</div>
        )}
      </div>
    </div>
  );
}
