/**
 * ArtifactBrowser — generated files gallery for agent runs.
 *
 * Extracts artifacts from tool_call outputs and artifact message blocks,
 * categorizes by type (image / code / document / web / other),
 * and provides preview, download, and diff-apply controls.
 *
 * Competitor references: Claude Code artifact preview, Cursor chat file list, Codex output browser.
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileImage,
  FileCode,
  FileText,
  Globe,
  Download,
  GitPullRequestArrow,
  Eye,
  X,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import type { TeamArtifactState } from '@/api/hubClient';
import type { ChatMessage, MessageBlock } from '@shared/types/chat';
import styles from './ArtifactBrowser.module.css';

// ── Types ──────────────────────────────────────

export type ArtifactCategory = 'image' | 'code' | 'document' | 'web' | 'other';

export interface ArtifactItem {
  id: string;
  title: string;
  path: string;
  category: ArtifactCategory;
  source: 'tool_call' | 'artifact_block' | 'team_artifact';
  toolName?: string;
  artifactUrl?: string;
  previewUrl?: string;
  content?: string;
  canApplyDiff?: boolean;
  diffApplied?: boolean;
  action?: string;
  status?: string;
}

function compactRecord<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

interface Props {
  /** Structured team artifacts from Hub (highest fidelity). */
  teamArtifacts?: TeamArtifactState[];
  /** Local-run tool calls whose outputs may reference generated files. */
  toolCallOutputs?: Array<{ callId: string; toolName: string; output?: string }>;
  /** Raw output text from the run, parsed as a fallback for unstructured artifact mentions. */
  outputText?: string;
  /** Chat messages that may contain artifact blocks. */
  chatMessages?: ChatMessage[];
  /** Callback when user clicks "Apply" on a code artifact. */
  onApplyDiff?: (artifact: ArtifactItem) => void;
}

// ── Helpers ───────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp',
  '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.sql',
  '.sh', '.bash', '.zsh', '.ps1', '.yaml', '.yml', '.json', '.toml', '.xml',
  '.css', '.scss', '.less', '.html', '.vue', '.svelte', '.astro',
  '.md', '.mdx', '.graphql', '.proto', '.prisma',
]);

const DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt',
  '.log', '.rtf',
]);

const WEB_EXTENSIONS = new Set(['.html', '.htm']);

const PLACEHOLDER_PREVIEWS: Record<ArtifactCategory, string> = {
  image: '',
  code: '',
  document: '',
  web: '',
  other: '',
};

function categorizeByPath(path: string): ArtifactCategory {
  const lower = path.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  // HTML without extension overlap — web also matches .html but those are already in CODE_EXTENSIONS
  // Actually .html is in both; code wins for single .html, web wins for directories with index.html
  if (ext === '.html' || ext === '.htm') {
    // Heuristic: if path looks like a web page (has index or is in a /public/ /dist/ dir) → web, else code
    if (/[/\\](index|public|dist|build|out)[/\\]/.test(lower) || /index\.html?$/.test(lower)) return 'web';
    return 'code';
  }
  return 'other';
}

function titleFromPath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  return segments[segments.length - 1] || path;
}

function extractArtifactsFromToolOutputs(
  outputs: Array<{ callId: string; toolName: string; output?: string }>,
): ArtifactItem[] {
  const artifacts: ArtifactItem[] = [];
  const seen = new Set<string>();

  for (const tc of outputs) {
    if (!tc.output) continue;

    // Try to find file paths in tool output — common patterns:
    // - "Wrote contents to /path/to/file.ts"
    // - "Created file: /path/to/file.png"
    // - "Saved output to /path/to/result.html"
    // - Bare paths: "/absolute/path/to/file.ext" or "./relative/path/file.ext"
    const pathPattern = /(?:Wrote\s+(?:contents\s+)?to|Created(?:\s+file)?:|Saved\s+(?:output\s+)?to|Generated\s+(?:file\s+)?at|Output\s+(?:written\s+)?to)[:\s]+([^\s\n\r]+\.\w+)/gi;
    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(tc.output)) !== null) {
      const capturedPath = match[1];
      if (!capturedPath) continue;
      const path = capturedPath.replace(/^["']|["']$/g, '');
      if (seen.has(path)) continue;
      seen.add(path);

      artifacts.push({
        id: `tc-${tc.callId}-${artifacts.length}`,
        title: titleFromPath(path),
        path,
        category: categorizeByPath(path),
        source: 'tool_call',
        toolName: tc.toolName,
        content: tc.output,
        canApplyDiff: CODE_EXTENSIONS.has(path.toLowerCase().slice(path.lastIndexOf('.'))),
      });
    }

    // Also look for bare absolute or relative paths (fallback for unstructured outputs)
    if (artifacts.length === 0 || pathPattern.lastIndex === 0) {
      const barePathPattern = /(?:^|\s)((?:\.{0,2}[\/\\]|(?:\/|[A-Za-z]:[\/\\]))[\w\-.\/\\]+\.\w{1,10})(?:\s|$)/gm;
      let bareMatch: RegExpExecArray | null;
      while ((bareMatch = barePathPattern.exec(tc.output)) !== null) {
        const capturedBarePath = bareMatch[1];
        if (!capturedBarePath) continue;
        const path = capturedBarePath.trim();
        if (seen.has(path)) continue;
        const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext) && !CODE_EXTENSIONS.has(ext) && !DOCUMENT_EXTENSIONS.has(ext) && !WEB_EXTENSIONS.has(ext)) continue;
        seen.add(path);

        artifacts.push({
          id: `tc-bare-${tc.callId}-${artifacts.length}`,
          title: titleFromPath(path),
          path,
          category: categorizeByPath(path),
          source: 'tool_call',
          toolName: tc.toolName,
          content: tc.output,
          canApplyDiff: CODE_EXTENSIONS.has(ext),
        });
      }
    }
  }

  return artifacts;
}

function extractArtifactsFromMessages(messages: ChatMessage[] | undefined): ArtifactItem[] {
  if (!messages?.length) return [];

  const artifacts: ArtifactItem[] = [];

  for (const msg of messages) {
    for (const block of msg.blocks) {
      if (block.kind !== 'artifact') continue;

      const artBlock = block as Extract<MessageBlock, { kind: 'artifact' }>;
      const category = mapArtifactBlockType(artBlock.artifactType);

      artifacts.push(compactRecord<ArtifactItem>({
        id: artBlock.artifactId,
        title: artBlock.title,
        path: artBlock.title,
        category,
        source: 'artifact_block',
        artifactUrl: artBlock.artifactUrl ?? artBlock.url,
        previewUrl: artBlock.previewUrl,
        canApplyDiff: artBlock.canApplyDiff,
        diffApplied: artBlock.diffApplied,
      }));
    }
  }

  return artifacts;
}

function mapArtifactBlockType(type: string): ArtifactCategory {
  switch (type) {
    case 'image': return 'image';
    case 'file': return 'code';
    case 'page': return 'web';
    case 'iframe': return 'web';
    default: return 'other';
  }
}

function extractArtifactsFromTeamState(teamArtifacts: TeamArtifactState[]): ArtifactItem[] {
  return teamArtifacts
    .filter((a) => a.path)
    .map((a, i) => compactRecord<ArtifactItem>({
      id: `ta-${a.event_seq ?? i}-${a.path}`,
      title: titleFromPath(a.path),
      path: a.path,
      category: categorizeByPath(a.path),
      source: 'team_artifact' as const,
      toolName: a.tool_name,
      action: a.action,
      status: a.status,
      canApplyDiff: a.action === 'modified' || a.action === 'created' && CODE_EXTENSIONS.has(a.path.toLowerCase().slice(a.path.lastIndexOf('.'))),
    }));
}

/**
 * Parse raw run output text for file paths as a fallback when tool-call outputs
 * are unavailable. Uses the same heuristics as `extractArtifactsFromToolOutputs`
 * but consumes the whole run output buffer as a single blob.
 *
 * This follows the `buildDisplayedRunOutputMessage` pattern: the raw output
 * text is the same content that gets wrapped into a ChatMessage text block
 * by that utility.
 */
function extractArtifactsFromOutputText(outputText: string): ArtifactItem[] {
  if (!outputText?.trim()) return [];

  const artifacts: ArtifactItem[] = [];
  const seen = new Set<string>();

  // Same patterns as tool output extraction
  const pathPattern = /(?:Wrote\s+(?:contents\s+)?to|Created(?:\s+file)?:|Saved\s+(?:output\s+)?to|Generated\s+(?:file\s+)?at|Output\s+(?:written\s+)?to)[:\s]+([^\s\n\r]+\.\w+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(outputText)) !== null) {
    const capturedPath = match[1];
    if (!capturedPath) continue;
    const path = capturedPath.replace(/^["']|["']$/g, '');
    if (seen.has(path)) continue;
    seen.add(path);

    artifacts.push({
      id: `runout-${artifacts.length}`,
      title: titleFromPath(path),
      path,
      category: categorizeByPath(path),
      source: 'tool_call',
      content: outputText,
      canApplyDiff: CODE_EXTENSIONS.has(path.toLowerCase().slice(path.lastIndexOf('.'))),
    });
  }

  // Fallback: bare paths
  const barePathPattern = /(?:^|\s)((?:\.{0,2}[\/\\]|(?:\/|[A-Za-z]:[\/\\]))[\w\-.\/\\]+\.\w{1,10})(?:\s|$)/gm;
  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = barePathPattern.exec(outputText)) !== null) {
    const capturedBarePath = bareMatch[1];
    if (!capturedBarePath) continue;
    const path = capturedBarePath.trim();
    if (seen.has(path)) continue;
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext) && !CODE_EXTENSIONS.has(ext) && !DOCUMENT_EXTENSIONS.has(ext) && !WEB_EXTENSIONS.has(ext)) continue;
    seen.add(path);

    artifacts.push({
      id: `runout-bare-${artifacts.length}`,
      title: titleFromPath(path),
      path,
      category: categorizeByPath(path),
      source: 'tool_call',
      canApplyDiff: CODE_EXTENSIONS.has(ext),
    });
  }

  return artifacts;
}

function mergeArtifacts(...sources: ArtifactItem[][]): ArtifactItem[] {
  const seen = new Set<string>();
  const merged: ArtifactItem[] = [];

  for (const source of sources) {
    for (const item of source) {
      const key = item.path || item.id;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
}

// ── Sub-components ────────────────────────────

function CategoryIcon({ category }: { category: ArtifactCategory }) {
  const size = 14;
  switch (category) {
    case 'image': return <FileImage size={size} className={styles.catIconImage} />;
    case 'code': return <FileCode size={size} className={styles.catIconCode} />;
    case 'document': return <FileText size={size} className={styles.catIconDoc} />;
    case 'web': return <Globe size={size} className={styles.catIconWeb} />;
    default: return <FolderOpen size={size} className={styles.catIconOther} />;
  }
}

const CATEGORY_TABS: { key: ArtifactCategory | 'all'; labelKey: string }[] = [
  { key: 'all', labelKey: 'run.artifact.all' },
  { key: 'code', labelKey: 'run.artifact.code' },
  { key: 'image', labelKey: 'run.artifact.image' },
  { key: 'document', labelKey: 'run.artifact.document' },
  { key: 'web', labelKey: 'run.artifact.web' },
  { key: 'other', labelKey: 'run.artifact.other' },
];

function PreviewPanel({
  artifact,
  onClose,
  onApplyDiff,
}: {
  artifact: ArtifactItem;
  onClose: () => void;
  onApplyDiff?: (artifact: ArtifactItem) => void;
}) {
  const { t } = useTranslation();

  const canPreview = artifact.category === 'image' || artifact.category === 'web';
  const hasContent = Boolean(artifact.content);

  return (
    <div className={styles.previewOverlay}>
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>{artifact.title}</span>
        <div className={styles.previewActions}>
          {artifact.canApplyDiff && onApplyDiff && (
            <button
              className={styles.previewBtn}
              onClick={() => onApplyDiff(artifact)}
              title={t('run.artifact.apply')}
            >
              <GitPullRequestArrow size={14} />
              <span>{t('run.artifact.apply')}</span>
            </button>
          )}
          <button
            className={styles.previewBtn}
            onClick={() => {
              const blob = new Blob(
                [artifact.content ?? ''],
                { type: 'text/plain;charset=utf-8' },
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = artifact.title;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 100);
            }}
            title={t('run.artifact.download')}
          >
            <Download size={14} />
          </button>
          <button
            className={styles.previewBtn}
            onClick={onClose}
            title={t('run.artifact.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className={styles.previewBody}>
        {artifact.category === 'image' && (
          <div className={styles.imagePreview}>
            {artifact.previewUrl || artifact.artifactUrl ? (
              <img
                src={artifact.previewUrl ?? artifact.artifactUrl}
                alt={artifact.title}
                className={styles.previewImage}
              />
            ) : (
              <div className={styles.previewPlaceholder}>
                <FileImage size={32} />
                <span>{artifact.path}</span>
              </div>
            )}
          </div>
        )}
        {artifact.category === 'web' && (
          <div className={styles.webPreview}>
            {artifact.artifactUrl ? (
              <iframe
                src={artifact.artifactUrl}
                title={artifact.title}
                className={styles.previewIframe}
                sandbox="allow-scripts"
              />
            ) : (
              <div className={styles.previewPlaceholder}>
                <Globe size={32} />
                <span>{t('run.artifact.noPreview')}</span>
              </div>
            )}
          </div>
        )}
        {(artifact.category === 'code' || artifact.category === 'document' || artifact.category === 'other') && (
          <div className={styles.codePreview}>
            {hasContent ? (
              <pre className={styles.previewCode}>
                <code>{artifact.content!.slice(0, 10000)}</code>
              </pre>
            ) : (
              <div className={styles.previewPlaceholder}>
                <FileCode size={32} />
                <span>{artifact.path}</span>
                {!canPreview && (
                  <span className={styles.previewHint}>{t('run.artifact.noPreview')}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────

export default function ArtifactBrowser({
  teamArtifacts,
  toolCallOutputs,
  outputText,
  chatMessages,
  onApplyDiff,
}: Props) {
  const { t } = useTranslation();

  const [activeCategory, setActiveCategory] = useState<ArtifactCategory | 'all'>('all');
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);

  const allArtifacts = useMemo(() => {
    const fromTeam = teamArtifacts ? extractArtifactsFromTeamState(teamArtifacts) : [];
    const fromToolOutputs = toolCallOutputs ? extractArtifactsFromToolOutputs(toolCallOutputs) : [];
    const fromOutputText = outputText ? extractArtifactsFromOutputText(outputText) : [];
    const fromMessages = extractArtifactsFromMessages(chatMessages);
    return mergeArtifacts(fromTeam, fromToolOutputs, fromOutputText, fromMessages);
  }, [teamArtifacts, toolCallOutputs, outputText, chatMessages]);

  const filteredArtifacts = useMemo(() => {
    if (activeCategory === 'all') return allArtifacts;
    return allArtifacts.filter((a) => a.category === activeCategory);
  }, [allArtifacts, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allArtifacts.length };
    for (const cat of CATEGORY_TABS) {
      if (cat.key === 'all') continue;
      counts[cat.key] = allArtifacts.filter((a) => a.category === cat.key).length;
    }
    return counts;
  }, [allArtifacts]);

  if (allArtifacts.length === 0) {
    return (
      <section className={styles.section}>
        <div className={styles.emptyCard}>
          <FolderOpen size={16} />
          <span>{t('run.artifact.empty')}</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      {/* Category tabs */}
      <div className={styles.tabBar}>
        {CATEGORY_TABS.map((tab) => {
          const count = categoryCounts[tab.key] ?? 0;
          if (tab.key !== 'all' && count === 0) return null;
          return (
            <button
              key={tab.key}
              className={`${styles.tab} ${activeCategory === tab.key ? styles.tabActive : ''}`}
              onClick={() => setActiveCategory(tab.key)}
            >
              {tab.key !== 'all' && <CategoryIcon category={tab.key as ArtifactCategory} />}
              <span>{t(tab.labelKey)}</span>
              <span className={styles.tabCount}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Artifact list */}
      <div className={styles.artifactList}>
        {filteredArtifacts.map((artifact) => (
          <div
            key={artifact.id}
            className={`${styles.artifactRow} ${selectedArtifact?.id === artifact.id ? styles.artifactRowActive : ''}`}
          >
            <div
              className={styles.artifactInfo}
              onClick={() =>
                setSelectedArtifact(
                  selectedArtifact?.id === artifact.id ? null : artifact,
                )
              }
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedArtifact(
                    selectedArtifact?.id === artifact.id ? null : artifact,
                  );
                }
              }}
            >
              <CategoryIcon category={artifact.category} />
              <code className={styles.artifactPath} title={artifact.path}>
                {artifact.title}
              </code>
              {artifact.action && (
                <span className={styles.artifactAction}>{artifact.action}</span>
              )}
            </div>
            <div className={styles.artifactActions}>
              <button
                className={styles.artifactBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedArtifact(
                    selectedArtifact?.id === artifact.id ? null : artifact,
                  );
                }}
                title={t('run.artifact.preview')}
              >
                <Eye size={13} />
              </button>
              <button
                className={styles.artifactBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  const blob = new Blob(
                    [artifact.content ?? ''],
                    { type: 'text/plain;charset=utf-8' },
                  );
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = artifact.title;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 100);
                }}
                title={t('run.artifact.download')}
              >
                <Download size={13} />
              </button>
              {artifact.artifactUrl && (
                <a
                  href={artifact.artifactUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.artifactBtn}
                  title={t('run.artifact.openExternal')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={13} />
                </a>
              )}
              {artifact.canApplyDiff && onApplyDiff && (
                <button
                  className={`${styles.artifactBtn} ${artifact.diffApplied ? styles.appliedBtn : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onApplyDiff(artifact);
                  }}
                  title={
                    artifact.diffApplied
                      ? t('run.artifact.applied')
                      : t('run.artifact.apply')
                  }
                  disabled={artifact.diffApplied}
                >
                  <GitPullRequestArrow size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Inline preview for selected artifact */}
      {selectedArtifact && (
        <PreviewPanel
          artifact={selectedArtifact}
          onClose={() => setSelectedArtifact(null)}
          {...(onApplyDiff ? { onApplyDiff } : {})}
        />
      )}
    </section>
  );
}
