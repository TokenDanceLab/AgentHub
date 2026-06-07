import React, { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  buildComposerIntent,
  canSubmitComposer,
  type ComposerMention,
  composerReducer,
  createInitialComposerState,
} from '../composer';
import type { AgentHubPlatform, WorkbenchAgent, WorkbenchConversation } from '../platform';
import { collectTranscriptEvidence } from '../transcript';
import type { TranscriptBlock } from '../transcript';
import { ConversationSidebar } from './ConversationSidebar';
import {
  ContextMenu,
  MultiSelectBar,
  Toast,
  type ContextMenuItem,
  type MultiSelectBarAction,
} from './floating';
import { GlobalRail, type GlobalRailPage } from './GlobalRail';
import { RightInspector } from './RightInspector';
import { TranscriptView } from './TranscriptView';
import { UnifiedComposer } from './UnifiedComposer';
import { WorkbenchRoutes } from './WorkbenchRoutes';
import { WorkspaceHeader } from './WorkspaceHeader';
import styles from './AgentHubWorkbench.module.css';

const INSPECTOR_MIN_WIDTH = 300;
const INSPECTOR_MAX_WIDTH = 760;
const INSPECTOR_COLLAPSE_WIDTH = 220;
const INSPECTOR_RESTORE_WIDTH = 260;
const INSPECTOR_DEFAULT_WIDTH = 400;
const DEFAULT_BROWSER_PREVIEW_URL_BY_SURFACE = {
  desktop: 'http://127.0.0.1:5176/desktop/',
  web: 'http://127.0.0.1:5176/desktop/',
} as const;

export interface AgentHubWorkbenchProps {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  agents?: WorkbenchAgent[];
  activeConversationId?: string;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  transcript: TranscriptBlock[];
}

export function AgentHubWorkbench({
  platform,
  conversations,
  agents = [],
  activeConversationId,
  onActiveConversationChange,
  transcript,
}: AgentHubWorkbenchProps): React.ReactElement {
  const fallbackConversationId = conversations[0]?.id ?? 'default';
  const [localConversationId, setLocalConversationId] = useState(fallbackConversationId);
  const controlledConversationExists = conversations.some((conversation) => conversation.id === activeConversationId);
  const localConversationExists = conversations.some((conversation) => conversation.id === localConversationId);
  const currentConversationId = controlledConversationExists
    ? activeConversationId!
    : localConversationExists
      ? localConversationId
      : fallbackConversationId;
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [inspectorResizing, setInspectorResizing] = useState(false);
  const [activePage, setActivePage] = useState<GlobalRailPage>('chat');
  const [contextMenu, setContextMenu] = useState<{
    blockId: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [actionedBlockIds, setActionedBlockIds] = useState<string[]>([]);
  const [softHiddenBlockIds, setSoftHiddenBlockIds] = useState<string[]>([]);
  const [selectBarRect, setSelectBarRect] = useState<{ left: number; width: number } | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const [composer, dispatchComposer] = useReducer(
    composerReducer,
    currentConversationId,
    createInitialComposerState,
  );
  const evidence = collectTranscriptEvidence(transcript);
  const activeConversation = conversations.find((conversation) => conversation.id === currentConversationId);
  const isChatPage = activePage === 'chat';
  const mentionableAgents: ComposerMention[] = agents.map((agent) => ({
    id: agent.id,
    label: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.status ? { status: agent.status } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.runtimeId ? { runtimeId: agent.runtimeId } : {}),
  }));

  useEffect(() => {
    dispatchComposer({ type: 'setConversationId', conversationId: currentConversationId });
  }, [currentConversationId]);

  useEffect(() => {
    if (!inspectorResizing) return;

    function updateFromPointer(event: PointerEvent): void {
      updateInspectorWidthFromClientX(event.clientX);
    }

    function stopResize(): void {
      setInspectorResizing(false);
    }

    window.addEventListener('pointermove', updateFromPointer);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', updateFromPointer);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [inspectorResizing]);

  useEffect(() => {
    if (!selectionMode) return;

    function closeSelection(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setSelectionMode(false);
        setSelectedBlockIds([]);
      }
    }

    document.addEventListener('keydown', closeSelection);
    return () => document.removeEventListener('keydown', closeSelection);
  }, [selectionMode]);

  useEffect(() => {
    if (!selectionMode) return;

    function updateSelectBarRect(): void {
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSelectBarRect({
        left: rect.left,
        width: rect.width,
      });
    }

    updateSelectBarRect();
    window.addEventListener('resize', updateSelectBarRect);
    return () => window.removeEventListener('resize', updateSelectBarRect);
  }, [selectionMode, inspectorCollapsed, inspectorWidth]);

  async function submitComposer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmitComposer(composer)) return;

    dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });
    try {
      await platform.runs.submitComposerIntent(buildComposerIntent(composer));
      dispatchComposer({ type: 'resetAfterSubmit' });
    } catch {
      dispatchComposer({ type: 'setSubmitState', submitState: 'error' });
    }
  }

  function clampInspectorWidth(value: number): number {
    return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(value)));
  }

  function updateInspectorWidthFromClientX(clientX: number): void {
    const nextWidth = window.innerWidth - clientX;
    if (nextWidth <= INSPECTOR_COLLAPSE_WIDTH) {
      setInspectorCollapsed(true);
      return;
    }
    if (inspectorCollapsed && nextWidth < INSPECTOR_RESTORE_WIDTH) return;
    setInspectorCollapsed(false);
    setInspectorWidth(clampInspectorWidth(nextWidth));
  }

  function beginInspectorResize(clientX: number): void {
    if (inspectorCollapsed) return;
    setInspectorResizing(true);
    updateInspectorWidthFromClientX(clientX);
  }

  function resizeInspectorBy(delta: number): void {
    const nextWidth = inspectorWidth + delta;
    if (nextWidth <= INSPECTOR_COLLAPSE_WIDTH) {
      setInspectorCollapsed(true);
      return;
    }
    setInspectorCollapsed(false);
    setInspectorWidth(clampInspectorWidth(nextWidth));
  }

  function handleToggleTheme(): void {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme') ?? 'light';
    root.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
  }

  function showWorkbenchToast(message: string): void {
    setToastMessage(message);
    setToastVisible(true);
    window.setTimeout(() => setToastVisible(false), 1700);
  }

  function blockTitle(block: TranscriptBlock): string {
    switch (block.kind) {
      case 'text':
        return block.text.slice(0, 28) || block.author.name;
      case 'tool_call':
        return block.toolName;
      case 'diff':
      case 'approval':
      case 'artifact':
      case 'subagent':
      case 'child_agent':
      case 'run_session':
      case 'run_step_group':
        return block.title;
      case 'agent_timeline':
        return block.title ?? '运行时间线';
      case 'result':
        return block.summary || (block.success ? '运行结果' : '运行失败');
      case 'thinking':
        return '思考过程';
      case 'route_decision':
        return block.targetAgent || block.action;
      case 'context_usage':
        return block.modelLabel || '上下文用量';
      default:
        return '消息卡片';
    }
  }

  function blockTitleById(blockId: string): string {
    const block = transcript.find((item) => item.id === blockId);
    return block ? blockTitle(block) : '选中卡片';
  }

  function openBlockContextMenu(
    block: TranscriptBlock,
    event: React.MouseEvent<HTMLElement>,
  ): void {
    event.preventDefault();
    setContextMenu({
      blockId: block.id,
      title: blockTitle(block),
      x: event.clientX,
      y: event.clientY,
    });
  }

  function selectBlock(blockId: string): void {
    setSelectedBlockIds((current) => (
      current.includes(blockId)
        ? current.filter((id) => id !== blockId)
        : [...current, blockId]
    ));
  }

  function selectConversation(conversationId: string): void {
    setLocalConversationId(conversationId);
    setContextMenu(null);
    setSelectionMode(false);
    setSelectedBlockIds([]);
    setActionedBlockIds([]);
    setSoftHiddenBlockIds([]);
    onActiveConversationChange?.(conversationId);
  }

  function enterSelection(blockId: string): void {
    setSelectionMode(true);
    setSelectedBlockIds([blockId]);
  }

  function copyText(text: string): void {
    try {
      navigator.clipboard?.writeText?.(text)?.catch?.(() => {});
    } catch {
      // Clipboard is optional in local preview and test environments.
    }
  }

  function pulseBlock(blockId: string): void {
    setActionedBlockIds((current) => (
      current.includes(blockId) ? current : [...current, blockId]
    ));
    window.setTimeout(() => {
      setActionedBlockIds((current) => current.filter((id) => id !== blockId));
    }, 900);
  }

  function cardActionLabel(action: string, title: string): string {
    const labels: Record<string, string> = {
      copy: '已复制卡片内容',
      react: '已打开表情回复',
      reply: `正在回复 ${title}`,
      forward: '已加入转发队列',
      topic: '已创建话题草稿',
      pin: '已更新置顶',
      link: '已复制消息链接',
      translate: '已加入翻译队列',
      task: '已添加到任务草稿',
      export: '已导出到云文档草稿',
      apps: '已打开快捷应用',
      delete: '已标记删除',
    };
    return labels[action] ?? '操作已记录';
  }

  function multiActionLabel(action: string, count: number): string {
    const labels: Record<string, string> = {
      copy: `已复制 ${count} 项`,
      forward: `已准备转发 ${count} 项`,
      task: `已为 ${count} 项创建任务草稿`,
      export: `已导出 ${count} 项到文档草稿`,
      delete: `已删除 ${count} 项`,
    };
    return labels[action] ?? `已处理 ${count} 项`;
  }

  function runContextAction(action: string, blockId: string): void {
    const title = blockTitleById(blockId);
    if (action === 'copy') copyText(title);
    if (action === 'link') copyText(`agenthub://card/${blockId}`);
    if (action === 'delete') {
      setSoftHiddenBlockIds((current) => (
        current.includes(blockId) ? current : [...current, blockId]
      ));
    }
    pulseBlock(blockId);
    showWorkbenchToast(cardActionLabel(action, title));
  }

  function runMultiAction(action: string): void {
    const count = selectedBlockIds.length;
    if (!count) {
      showWorkbenchToast('还没有选择卡片');
      return;
    }
    if (action === 'copy') {
      copyText(selectedBlockIds.map(blockTitleById).join('\n'));
    }
    if (action === 'delete') {
      setSoftHiddenBlockIds((current) => {
        const next = new Set(current);
        selectedBlockIds.forEach((id) => next.add(id));
        return Array.from(next);
      });
      setSelectionMode(false);
      setSelectedBlockIds([]);
    }
    showWorkbenchToast(multiActionLabel(action, count));
  }

  function contextMenuGroups(blockId: string): Array<Array<ContextMenuItem>> {
    return [
      [
        { label: '复制', icon: 'fileText', shortcut: 'Ctrl C', onClick: () => runContextAction('copy', blockId) },
        { label: '表情回复', icon: 'star', chevron: true, onClick: () => runContextAction('react', blockId) },
        { label: '回复', icon: 'notes', onClick: () => runContextAction('reply', blockId) },
        { label: '转发', icon: 'external', onClick: () => runContextAction('forward', blockId) },
      ],
      [
        { label: '创建话题', icon: 'groups', onClick: () => runContextAction('topic', blockId) },
        { label: '多选', icon: 'grid', shortcut: 'Shift', onClick: () => enterSelection(blockId) },
        { label: '置顶消息', icon: 'bell', onClick: () => runContextAction('pin', blockId) },
        { label: '复制消息链接', icon: 'external', onClick: () => runContextAction('link', blockId) },
        { label: '翻译', icon: 'library', onClick: () => runContextAction('translate', blockId) },
      ],
      [
        { label: '添加任务', icon: 'running', onClick: () => runContextAction('task', blockId) },
        { label: '导出到文档', icon: 'download', onClick: () => runContextAction('export', blockId) },
        { label: '快捷应用', icon: 'tools', chevron: true, onClick: () => runContextAction('apps', blockId) },
        { label: '删除', icon: 'archive', danger: true, onClick: () => runContextAction('delete', blockId) },
      ],
    ];
  }

  const multiSelectActions: Array<MultiSelectBarAction> = [
    {
      label: '全选',
      icon: 'done',
      onClick: () => setSelectedBlockIds(transcript.map((block) => block.id)),
    },
    {
      label: '清空',
      icon: 'filter',
      onClick: () => setSelectedBlockIds([]),
    },
    { label: '复制', icon: 'fileText', onClick: () => runMultiAction('copy') },
    { label: '转发', icon: 'external', onClick: () => runMultiAction('forward') },
    { label: '添加任务', icon: 'running', onClick: () => runMultiAction('task') },
    { label: '导出文档', icon: 'download', onClick: () => runMultiAction('export') },
    { label: '删除', icon: 'archive', danger: true, onClick: () => runMultiAction('delete') },
    {
      label: '退出',
      icon: 'close',
      ghost: true,
      onClick: () => {
        setSelectionMode(false);
        setSelectedBlockIds([]);
      },
    },
  ];

  const shellStyle = {
    '--inspector-w': `${inspectorWidth}px`,
  } as React.CSSProperties;

  return (
    <div
      className={styles.shell}
      data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}
      data-inspector-resizing={inspectorResizing ? 'true' : 'false'}
      data-page={activePage}
      data-selection-mode={selectionMode ? 'true' : 'false'}
      data-testid="agenthub-workbench"
      style={shellStyle}
    >
      <GlobalRail
        activePage={activePage}
        onNavigate={setActivePage}
        onToggleTheme={handleToggleTheme}
      />
      {isChatPage && (
        <ConversationSidebar
          activeConversationId={currentConversationId}
          conversations={conversations}
          onSelectConversation={selectConversation}
        />
      )}

      <main
        ref={workspaceRef}
        aria-label="Workspace"
        className={styles.workspace}
        data-mode={isChatPage ? 'chat' : 'workbench'}
        data-surface={platform.surface}
      >
        {isChatPage ? (
          <>
            <WorkspaceHeader
              activeConversation={activeConversation}
              inspectorCollapsed={inspectorCollapsed}
              onToggleInspector={() => setInspectorCollapsed((collapsed) => !collapsed)}
            />
            <TranscriptView
              actionedBlockIds={actionedBlockIds}
              contextBlockId={contextMenu?.blockId}
              onBlockContextMenu={openBlockContextMenu}
              onBlockSelect={selectBlock}
              pinnedAnnouncement={activeConversation?.pinnedAnnouncement ? {
                ...activeConversation.pinnedAnnouncement,
                onCopy: () => showWorkbenchToast('已打开置顶内容'),
                onDismiss: () => showWorkbenchToast('已关闭置顶'),
              } : undefined}
              selectedBlockIds={selectedBlockIds}
              selectionMode={selectionMode}
              softHiddenBlockIds={softHiddenBlockIds}
              transcript={transcript}
            />
            {!selectionMode && (
              <UnifiedComposer
                composer={composer}
                dispatchComposer={dispatchComposer}
                mentionableAgents={mentionableAgents}
                onPickLocalAttachments={platform.attachments?.pickFiles}
                onSubmit={submitComposer}
                targetLabel={activeConversation?.title ?? 'AgentHub'}
              />
            )}
          </>
        ) : (
          <section aria-label="Workbench page" className={styles.workbenchPageHost}>
            <WorkbenchRoutes activePage={activePage} agents={agents} />
          </section>
        )}
      </main>

      {isChatPage && (
        <RightInspector
          browserPreviewEnabled={platform.capabilities.browserPreview}
          canOpenPreview={platform.preview?.canOpenEvidence}
          collapsed={inspectorCollapsed}
          defaultBrowserUrl={DEFAULT_BROWSER_PREVIEW_URL_BY_SURFACE[platform.surface]}
          evidence={evidence}
          maxWidth={INSPECTOR_MAX_WIDTH}
          minWidth={INSPECTOR_MIN_WIDTH}
          onOpenPreview={platform.preview?.openEvidence}
          onResizeBy={resizeInspectorBy}
          onResizeStart={beginInspectorResize}
          width={inspectorWidth}
        />
      )}
      {isChatPage && contextMenu && (
        <ContextMenu
          groups={contextMenuGroups(contextMenu.blockId)}
          isOpen={Boolean(contextMenu)}
          title={contextMenu.title}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
      {isChatPage && selectionMode && (
        <MultiSelectBar
          actions={multiSelectActions}
          count={selectedBlockIds.length}
          total={transcript.length}
          workspaceLeft={selectBarRect?.left}
          workspaceWidth={selectBarRect?.width}
        />
      )}
      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
}
