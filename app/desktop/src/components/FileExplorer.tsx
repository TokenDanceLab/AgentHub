import {
  useState,
  useEffect,
  useCallback,
  memo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent,
  type DragEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import {
  ChevronRight,
  File,
  FileCode,
  FileText,
  FileImage,
  FileJson,
  FileType,
  Folder,
  FolderOpen,
  Plus,
  FolderPlus,
  Pencil,
  Trash2,
  ExternalLink,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import type { ViewProps } from '@/config/viewRegistry';
import { gitStatusChar, type GitStatus } from '@/hooks/useGitStatus';
import styles from './FileExplorer.module.css';

// ── Types ──

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileEntry[] | null;
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

interface FileExplorerProps extends Partial<ViewProps> {
  rootDir?: string;
  onFileSelect?: (path: string) => void;
  className?: string;
  gitStatus?: GitStatus | null;
}

// ── File extension -> icon mapping ──

const FILE_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  ts: FileType,
  tsx: FileType,
  js: FileCode,
  jsx: FileCode,
  json: FileJson,
  css: FileCode,
  scss: FileCode,
  html: FileCode,
  htm: FileCode,
  md: FileText,
  markdown: FileText,
  txt: FileText,
  log: FileText,
  env: FileText,
  gitignore: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  ico: FileImage,
  webp: FileImage,
  rs: FileCode,
  go: FileCode,
  py: FileCode,
  rb: FileCode,
  java: FileCode,
  c: FileCode,
  cpp: FileCode,
  h: FileCode,
  hpp: FileCode,
  sh: FileCode,
  bash: FileCode,
  yml: FileCode,
  yaml: FileCode,
  toml: FileCode,
  xml: FileCode,
  sql: FileCode,
  graphql: FileCode,
  vue: FileCode,
  svelte: FileCode,
  astro: FileCode,
};

const FILE_COLOR_MAP: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f7df1e',
  jsx: '#f7df1e',
  json: '#f5a623',
  css: '#1572b6',
  scss: '#c6538c',
  html: '#e34f26',
  md: '#42a5f5',
  txt: '#888',
  rs: '#dea584',
  go: '#00add8',
  py: '#3776ab',
  rb: '#cc342d',
  java: '#b07219',
  svg: '#ffb13b',
  yml: '#6b8e23',
  toml: '#9c4221',
};

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === 0) return '';
  return filename.slice(dot + 1).toLowerCase();
}

function getFileIcon(filename: string): { Icon: React.ComponentType<{ size?: number; className?: string }>; color?: string } {
  const ext = getExtension(filename);
  const Icon = FILE_ICON_MAP[ext] || File;
  const color = FILE_COLOR_MAP[ext];
  return { Icon, color };
}

// ── Component ──

export default memo(function FileExplorer({
  rootDir,
  onFileSelect,
  className,
  gitStatus,
}: FileExplorerProps) {
  const { t } = useTranslation();
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop state
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [dragIsCopy, setDragIsCopy] = useState(false);

  // Load directory tree
  const loadTree = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<FileEntry[]>('read_dir_tree', { dir });
      setTree(result);
      // Auto-expand first level
      const firstLevel = new Set<string>();
      result.forEach((entry) => {
        if (entry.is_dir) firstLevel.add(entry.path);
      });
      setExpanded(firstLevel);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (rootDir) {
      void loadTree(rootDir);
    }
  }, [rootDir, loadTree]);

  // Toggle directory expansion
  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Select a file
  const selectFile = useCallback(
    (path: string, isDir: boolean) => {
      setSelectedPath(path);
      if (isDir) {
        toggleExpand(path);
      } else if (onFileSelect) {
        onFileSelect(path);
      }
    },
    [onFileSelect, toggleExpand],
  );

  // Context menu handlers
  const handleContextMenu = useCallback(
    (e: ReactMouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // File operations
  const handleCreateFile = useCallback(async (parentPath: string) => {
    closeContextMenu();
    const name = window.prompt(t('fileExplorer.newFilePrompt'));
    if (!name || !name.trim()) return;
    const newPath = parentPath.replace(/[/\\]$/, '') + '/' + name.trim();
    try {
      await invoke('create_file', { path: newPath, content: '' });
      if (rootDir) await loadTree(rootDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [closeContextMenu, loadTree, rootDir, t]);

  const handleCreateFolder = useCallback(async (parentPath: string) => {
    closeContextMenu();
    const name = window.prompt(t('fileExplorer.newFolderPrompt'));
    if (!name || !name.trim()) return;
    const dirPath = parentPath.replace(/[/\\]$/, '') + '/' + name.trim();
    try {
      await invoke('create_folder', { path: dirPath });
      if (rootDir) await loadTree(rootDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [closeContextMenu, loadTree, rootDir, t]);

  const handleRename = useCallback(async (oldPath: string) => {
    closeContextMenu();
    const parts = oldPath.replace(/[/\\]$/, '').split(/[/\\]/);
    const oldName = parts[parts.length - 1] ?? '';
    const newName = window.prompt(t('fileExplorer.renamePrompt'), oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const parent = parts.slice(0, -1).join('/');
    const newPath = parent + '/' + newName.trim();
    try {
      await invoke('rename_entry', { oldPath, newPath });
      if (rootDir) await loadTree(rootDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [closeContextMenu, loadTree, rootDir, t]);

  const handleDelete = useCallback(async (entryPath: string) => {
    closeContextMenu();
    const parts = entryPath.replace(/[/\\]$/, '').split(/[/\\]/);
    const name = parts[parts.length - 1] ?? '';
    const confirmed = await ask(t('fileExplorer.deleteConfirm', { name }), {
      title: t('fileExplorer.delete'),
      kind: 'warning',
    });
    if (!confirmed) return;
    try {
      await invoke('delete_entry', { path: entryPath });
      if (rootDir) await loadTree(rootDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [closeContextMenu, loadTree, rootDir, t]);

  const handleOpenInVSCode = useCallback((filePath: string) => {
    closeContextMenu();
    // Use shell open with vscode:// protocol or just invoke
    // For now, fallback: try to open via shell
    try {
      window.open(`vscode://file/${filePath}`, '_blank');
    } catch {
      // Fallback: post message for shell plugin
    }
  }, [closeContextMenu]);

  // ── Drag-and-Drop Handlers ──

  const handleDragStart = useCallback((e: DragEvent, path: string, _isDir: boolean) => {
    setDragSourcePath(path);
    setDragIsCopy(false);
    e.dataTransfer.setData('text/plain', path);
    e.dataTransfer.effectAllowed = 'copyMove';
    // Set a custom drag image (lightweight)
    if (e.dataTransfer.setDragImage) {
      const el = e.currentTarget as HTMLElement;
      e.dataTransfer.setDragImage(el, 0, 0);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent, targetPath: string, isDir: boolean) => {
    // Only directories can be drop targets
    if (!isDir) return;
    e.preventDefault();
    e.stopPropagation();
    // Prevent dropping onto self
    if (dragSourcePath === targetPath) return;
    // Prevent dropping into a child directory of self (would create a cycle)
    if (dragSourcePath && targetPath.startsWith(dragSourcePath + '/')) return;
    setDragOverPath(targetPath);
    const isCopy = e.ctrlKey || e.metaKey;
    setDragIsCopy(isCopy);
    e.dataTransfer.dropEffect = isCopy ? 'copy' : 'move';
  }, [dragSourcePath]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragIsCopy(false);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent, targetDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);

    if (!dragSourcePath || !targetDir || dragSourcePath === targetDir) return;

    // Prevent dropping into own children
    if (targetDir.startsWith(dragSourcePath + '/')) return;

    const srcParts = dragSourcePath.replace(/[/\\]$/, '').split(/[/\\]/);
    const srcName = srcParts[srcParts.length - 1] ?? 'item';
    const dstPath = targetDir.replace(/[/\\]$/, '') + '/' + srcName;

    const isCopy = e.ctrlKey || e.metaKey;

    // Confirm destructive move (especially cross-directory)
    const actionLabel = isCopy ? t('fileExplorer.copyHere', { name: srcName }) : t('fileExplorer.moveHere', { name: srcName });
    const confirmed = await ask(actionLabel, {
      title: isCopy ? t('fileExplorer.copy') : t('fileExplorer.move'),
      kind: 'info',
    });
    if (!confirmed) return;

    try {
      if (isCopy) {
        await invoke('copy_entry', { srcPath: dragSourcePath, dstPath });
      } else {
        await invoke('rename_entry', { oldPath: dragSourcePath, newPath: dstPath });
      }
      if (rootDir) await loadTree(rootDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [dragSourcePath, loadTree, rootDir, t]);

  // Clear drag state when leaving the tree entirely
  const handleTreeDragLeave = useCallback((e: DragEvent) => {
    // Only clear if we're leaving the tree container, not entering a child
    if (treeRef.current && !treeRef.current.contains(e.relatedTarget as Node)) {
      setDragOverPath(null);
      setDragIsCopy(false);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragSourcePath(null);
    setDragOverPath(null);
    setDragIsCopy(false);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    },
    [closeContextMenu],
  );

  // Render a single tree node
  const renderNode = useCallback(
    (entry: FileEntry, depth: number) => {
      const isExpanded = expanded.has(entry.path);
      const isSelected = selectedPath === entry.path;
      const isDir = entry.is_dir;

      const { Icon, color } = isDir
        ? { Icon: (isExpanded ? FolderOpen : Folder) as React.ComponentType<{ size?: number; className?: string }>, color: undefined }
        : getFileIcon(entry.name);

      const indent = 8 + depth * 16;

      // Drag-and-drop visual states
      const isDragSource = dragSourcePath === entry.path;
      const isDragOver = dragOverPath === entry.path;
      const dragOverClass = isDragOver
        ? (dragIsCopy ? styles.nodeDragOverCopy : styles.nodeDragOver)
        : '';

      // Git status overlay
      let gitLabel: string | undefined;
      let gitClass: string | undefined;
      if (!isDir && gitStatus) {
        const relPath = rootDir
          ? entry.path.replace(rootDir.replace(/[/\\]$/, '') + '/', '')
              .replace(/\\/g, '/')
          : entry.path.replace(/\\/g, '/');
        const statusChar = gitStatusChar(gitStatus, relPath);
        if (statusChar) {
          const labelMap: Record<string, string> = {
            'M': t('fileExplorer.gitModified'),
            'A': t('fileExplorer.gitAdded'),
            'D': t('fileExplorer.gitDeleted'),
            '?': t('fileExplorer.gitUntracked'),
            'R': t('fileExplorer.gitRenamed'),
            'U': t('fileExplorer.gitConflicted'),
          };
          // Map status char to CSS class suffix ('?' is not a valid identifier suffix)
          const classSuffixMap: Record<string, string> = {
            'M': 'M',
            'A': 'A',
            'D': 'D',
            '?': 'Question',
            'R': 'R',
            'U': 'U',
          };
          gitLabel = labelMap[statusChar] ?? statusChar;
          gitClass = styles[`gitStatus${classSuffixMap[statusChar] ?? 'M'}`] ?? styles.gitStatusM;
        }
      }

      return (
        <div key={entry.path}>
          <div
            className={`${styles.node} ${isSelected ? styles.nodeSelected : ''} ${isDragSource ? styles.nodeDragSource : ''} ${dragOverClass}`}
            style={{ '--indent': `${indent}px` } as React.CSSProperties}
            onClick={() => selectFile(entry.path, isDir)}
            onContextMenu={(e) => handleContextMenu(e, entry.path, isDir)}
            draggable
            onDragStart={(e) => handleDragStart(e, entry.path, isDir)}
            onDragOver={(e) => handleDragOver(e, entry.path, isDir)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, entry.path)}
            onDragEnd={handleDragEnd}
            role="treeitem"
            aria-expanded={isDir ? isExpanded : undefined}
            aria-selected={isSelected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectFile(entry.path, isDir);
              }
            }}
          >
            {isDir ? (
              <span
                className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(entry.path);
                }}
              >
                <ChevronRight size={14} />
              </span>
            ) : (
              <span className={styles.chevronPlaceholder} />
            )}
            <span className={styles.icon} style={color ? { color } : undefined}>
              <Icon size={16} />
            </span>
            <span className={styles.name}>{entry.name}</span>
            {gitClass && gitLabel && (
              <span className={`${styles.gitOverlay} ${gitClass}`} title={gitLabel}>
                {gitLabel.charAt(0)}
              </span>
            )}
          </div>

          {/* Render children if expanded */}
          {isDir && isExpanded && entry.children && (
            <div role="group">
              {entry.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    },
    [expanded, selectedPath, selectFile, handleContextMenu, toggleExpand, gitStatus, rootDir, t,
     dragSourcePath, dragOverPath, dragIsCopy, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd],
  );

  // Get context menu target info
  const contextTarget = contextMenu;
  const contextParentDir = contextTarget
    ? contextTarget.isDir
      ? contextTarget.path
      : contextTarget.path.replace(/[/\\][^/\\]*$/, '') || rootDir || ''
    : '';

  return (
    <div className={`${styles.root} ${className ?? ''}`} onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle} title={rootDir}>
          {rootDir ? rootDir.split(/[/\\]/).pop() || rootDir : t('fileExplorer.title')}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={styles.collapseBtn}
            onClick={() => {
              if (rootDir) void loadTree(rootDir);
            }}
            title={t('fileExplorer.refresh')}
          >
            <RefreshCw size={14} />
          </button>
          <button
            className={styles.collapseBtn}
            onClick={() => setExpanded(new Set())}
            title={t('fileExplorer.collapseAll')}
          >
            <ChevronRight size={14} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        </div>
      </div>

      {/* Tree area */}
      <div className={styles.treeWrapper} ref={treeRef} role="tree" onDragLeave={handleTreeDragLeave}>
        {loading && (
          <div className={styles.loading}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        {error && !loading && <div className={styles.errorMsg}>{error}</div>}
        {!loading && !error && tree.length === 0 && rootDir && (
          <div className={styles.empty}>{t('fileExplorer.empty')}</div>
        )}
        {!loading && !error && !rootDir && (
          <div className={styles.empty}>{t('fileExplorer.noWorkspace')}</div>
        )}
        {!loading &&
          tree.map((entry) => renderNode(entry, 0))}
      </div>

      {/* Context menu */}
      {contextTarget && (
        <>
          <div className={styles.contextOverlay} onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
          <div
            className={styles.contextMenu}
            style={{ left: contextTarget.x, top: contextTarget.y }}
          >
            <button
              className={styles.menuItem}
              onClick={() => handleCreateFile(contextParentDir)}
            >
              <Plus size={14} />
              {t('fileExplorer.newFile')}
            </button>
            <button
              className={styles.menuItem}
              onClick={() => handleCreateFolder(contextParentDir)}
            >
              <FolderPlus size={14} />
              {t('fileExplorer.newFolder')}
            </button>
            <div className={styles.menuDivider} />
            <button
              className={styles.menuItem}
              onClick={() => handleRename(contextTarget.path)}
            >
              <Pencil size={14} />
              {t('fileExplorer.rename')}
            </button>
            <button
              className={styles.menuItemDanger}
              onClick={() => handleDelete(contextTarget.path)}
            >
              <Trash2 size={14} />
              {t('fileExplorer.delete')}
            </button>
            {!contextTarget.isDir && (
              <>
                <div className={styles.menuDivider} />
                <button
                  className={styles.menuItem}
                  onClick={() => handleOpenInVSCode(contextTarget.path)}
                >
                  <ExternalLink size={14} />
                  {t('fileExplorer.openInVSCode')}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
});
