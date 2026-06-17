import React, { useCallback, useEffect } from 'react';
import { ConversationSidebar, type ConversationSidebarProps } from './ConversationSidebar';
import { ContextMenu, MultiSelectBar, ProfilePopover, Toast, type ContextMenuItem, type MultiSelectBarAction } from './floating';
import { GlobalRail, type GlobalRailPage } from './GlobalRail';
import { RightInspector, type RuntimeEvidenceSnapshot } from './RightInspector';
import { DESKTOP_TOGGLE_SIDEBAR_EVENT } from './desktopChromeEvents';
import { workbenchProfileInitials, workbenchAgentColor } from './profileRegistry';
import type { EvidenceRef } from '../transcript';
import type { FileItem } from './inspector';
import styles from './AgentHubWorkbench.module.css';

// Layout constants
export const INSPECTOR_MIN_WIDTH = 48;
export const INSPECTOR_MAX_WIDTH = 760;
export const INSPECTOR_DEFAULT_WIDTH = 400;
export const INSPECTOR_READABLE_WIDTH = 360;
export const INSPECTOR_COLLAPSE_SNAP_WIDTH = 96;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_COLLAPSE_SNAP_WIDTH = 96;
export const WORKSPACE_AUTO_COLLAPSE_WIDTH = 560;

// Types
export interface AgentProfileState { id: string; name: string; role: string; engine: string; model: string; state: string; skills: string[]; anchor: HTMLElement; }
export interface HumanProfileState { id: string; name: string; initials: string; org: string; status: string; tag: string; subtitle: string; avatarColor?: string; anchor: HTMLElement; }
export interface GroupProfileState { id: string; name: string; memberNames: string[]; anchor: HTMLElement; }
export type MainchainStatusKind = 'done' | 'active' | 'waiting' | 'blocked' | 'empty';
export interface MainchainNode { id: string; label: string; detail: string; state: MainchainStatusKind; }
export interface MainchainSummary { nodes: MainchainNode[]; exportEnabled: boolean; exportLabel: string; exportDetail: string; }

export interface InspectorResizeDelegates { onResizeBy(delta: number): void; onResizeStart(clientX: number): void; }

export interface WorkbenchShellProps {
  activePage: GlobalRailPage; isChatPage: boolean; onNavigateRail: (p: GlobalRailPage) => void;
  showMainchainStatus?: boolean;
  sidebarWidth: number; sidebarCollapsed: boolean; sidebarResizing: boolean;
  onSidebarWidthChange: (w: number) => void; onSidebarCollapsedChange: (c: boolean) => void; onSidebarResizingChange: (r: boolean) => void;
  sidebarWidthRef: React.MutableRefObject<number>; sidebarShouldCollapseRef: React.MutableRefObject<boolean>;
  inspectorWidth: number; inspectorCollapsed: boolean; inspectorResizing: boolean;
  onInspectorWidthChange: (w: number) => void; onInspectorCollapsedChange: (c: boolean) => void; onInspectorResizingChange: (r: boolean) => void;
  inspectorWidthRef: React.MutableRefObject<number>;
  workspaceRef: React.RefObject<HTMLElement>;
  sidebarProps: Pick<ConversationSidebarProps, 'activeConversationId' | 'conversations' | 'onAvatarClick' | 'onSelectConversation' | 'onPinConversation' | 'onArchiveConversation'>;
  railProps: { onLogout?: () => void; onToggleTheme: () => void; userDisplayName?: string; userAvatarUrl?: string };
  inspectorProps: { browserPreviewEnabled: boolean; canOpenPreview?: (e: EvidenceRef) => boolean; contextBlocks: any[]; defaultBrowserUrl: string; deployPreviewUrl?: string; evidence: EvidenceRef[]; onOpenPreview?: (e: EvidenceRef) => Promise<void>; reviewFileRequest: FileItem | null; routeBlocks: any[]; runtimeEvidence?: RuntimeEvidenceSnapshot; runResult?: { success: boolean; summary?: string; duration?: string }; workDir?: string };
  inspectorResizeDelegates: InspectorResizeDelegates;
  activeAgentProfile: AgentProfileState | null; activeHumanProfile: HumanProfileState | null; activeGroupProfile: GroupProfileState | null;
  onCloseAgentProfile: () => void; onCloseHumanProfile: () => void; onCloseGroupProfile: () => void;
  onAgentProfileAction: (a: string) => void; onHumanProfileAction: (a: string) => void; onGroupProfileAction: (a: string) => void;
  contextMenu: { blockId: string; title: string; x: number; y: number } | null; contextMenuGroups: (id: string) => Array<Array<ContextMenuItem>>; onCloseContextMenu: () => void;
  selectionMode: boolean; selectedBlockIds: string[]; selectBarRect: { left: number; width: number } | null; multiSelectActions: MultiSelectBarAction[]; totalBlocks: number;
  toastMessage: string; toastVisible: boolean; surface: string;
  children: React.ReactNode;
}

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, Math.round(v))); }
function statusLabel(s: string): string {
  switch (s) { case 'running': return '运行中'; case 'ready': case 'available': return '可运行'; case 'waiting': return '等待中'; case 'configuring': return '配置中'; case 'unavailable': return '不可用'; default: return s || 'Agent'; }
}

export const WorkbenchShell = React.memo(function WorkbenchShell({
  activePage, isChatPage, onNavigateRail,
  showMainchainStatus = true,
  sidebarWidth, sidebarCollapsed, sidebarResizing,
  onSidebarWidthChange, onSidebarCollapsedChange, onSidebarResizingChange,
  sidebarWidthRef, sidebarShouldCollapseRef,
  inspectorWidth, inspectorCollapsed, inspectorResizing,
  onInspectorWidthChange, onInspectorCollapsedChange, onInspectorResizingChange,
  inspectorWidthRef, inspectorResizeDelegates,
  workspaceRef,
  sidebarProps, railProps, inspectorProps,
  activeAgentProfile, activeHumanProfile, activeGroupProfile,
  onCloseAgentProfile, onCloseHumanProfile, onCloseGroupProfile,
  onAgentProfileAction, onHumanProfileAction, onGroupProfileAction,
  contextMenu, contextMenuGroups, onCloseContextMenu,
  selectionMode, selectedBlockIds, selectBarRect, multiSelectActions, totalBlocks,
  toastMessage, toastVisible, surface,
  children,
}: WorkbenchShellProps): React.ReactElement {
  const handleSidebarKeyResize = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 16;
    const delta = event.key === 'ArrowLeft' ? -step : step;
    const raw = sidebarWidth + delta;
    onSidebarCollapsedChange(false);
    if (raw <= SIDEBAR_COLLAPSE_SNAP_WIDTH || (sidebarWidth <= SIDEBAR_MIN_WIDTH && raw < SIDEBAR_MIN_WIDTH)) {
      sidebarWidthRef.current = SIDEBAR_MIN_WIDTH; onSidebarWidthChange(SIDEBAR_MIN_WIDTH); onSidebarCollapsedChange(true); return;
    }
    const c = clamp(raw, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    sidebarWidthRef.current = c; onSidebarWidthChange(c);
  }, [sidebarWidth, onSidebarWidthChange, onSidebarCollapsedChange, sidebarWidthRef]);

  const handleInspectorKeyResize = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 16;
    const delta = event.key === 'ArrowLeft' ? step : -step;
    const next = clamp(inspectorWidth + delta, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH);
    onInspectorCollapsedChange(false);
    if (isChatPage && !sidebarCollapsed && (window.innerWidth - 52 - sidebarWidthRef.current - next) < WORKSPACE_AUTO_COLLAPSE_WIDTH) onSidebarCollapsedChange(true);
    if (next <= INSPECTOR_COLLAPSE_SNAP_WIDTH) { inspectorWidthRef.current = INSPECTOR_MIN_WIDTH; onInspectorWidthChange(INSPECTOR_MIN_WIDTH); onInspectorCollapsedChange(true); return; }
    inspectorWidthRef.current = next; onInspectorWidthChange(next);
  }, [inspectorWidth, onInspectorWidthChange, onInspectorCollapsedChange, isChatPage, sidebarCollapsed, sidebarWidthRef, inspectorWidthRef, onSidebarCollapsedChange]);

  const beginSidebarResize = useCallback((clientX: number) => {
    if (sidebarCollapsed) return;
    sidebarShouldCollapseRef.current = false; onSidebarResizingChange(true);
    const next = clientX - 52; onSidebarCollapsedChange(false);
    if (next <= SIDEBAR_COLLAPSE_SNAP_WIDTH) { sidebarShouldCollapseRef.current = true; sidebarWidthRef.current = SIDEBAR_MIN_WIDTH; onSidebarWidthChange(SIDEBAR_MIN_WIDTH); return; }
    sidebarShouldCollapseRef.current = false;
    const c = clamp(next, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    sidebarWidthRef.current = c; onSidebarWidthChange(c);
  }, [sidebarCollapsed, sidebarShouldCollapseRef, onSidebarResizingChange, onSidebarCollapsedChange, onSidebarWidthChange, sidebarWidthRef]);

  const beginInspectorResize = useCallback((clientX: number) => {
    if (inspectorCollapsed) return;
    onInspectorResizingChange(true);
    const next = window.innerWidth - clientX; onInspectorCollapsedChange(false);
    const c = clamp(next, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH);
    if (isChatPage && !sidebarCollapsed && (window.innerWidth - 52 - sidebarWidthRef.current - c) < WORKSPACE_AUTO_COLLAPSE_WIDTH) onSidebarCollapsedChange(true);
    if (next <= INSPECTOR_COLLAPSE_SNAP_WIDTH) { inspectorWidthRef.current = INSPECTOR_MIN_WIDTH; onInspectorWidthChange(INSPECTOR_MIN_WIDTH); onInspectorResizingChange(false); requestAnimationFrame(() => onInspectorCollapsedChange(true)); return; }
    inspectorWidthRef.current = c; onInspectorWidthChange(c);
  }, [inspectorCollapsed, onInspectorResizingChange, onInspectorCollapsedChange, onInspectorWidthChange, inspectorWidthRef, isChatPage, sidebarCollapsed, sidebarWidthRef, onSidebarCollapsedChange]);

  // Desktop toggle sidebar event
  useEffect(() => {
    if (surface !== 'desktop' || activePage !== 'chat') return;
    const handler = () => {
      if (sidebarCollapsed || sidebarWidth < SIDEBAR_MIN_WIDTH) { sidebarWidthRef.current = SIDEBAR_DEFAULT_WIDTH; onSidebarWidthChange(SIDEBAR_DEFAULT_WIDTH); onSidebarCollapsedChange(false); }
      else onSidebarCollapsedChange(true);
    };
    window.addEventListener(DESKTOP_TOGGLE_SIDEBAR_EVENT, handler);
    return () => window.removeEventListener(DESKTOP_TOGGLE_SIDEBAR_EVENT, handler);
  }, [surface, activePage, sidebarCollapsed, sidebarWidth, sidebarWidthRef, onSidebarWidthChange, onSidebarCollapsedChange]);

  // Inspector resize pointer tracking
  useEffect(() => {
    if (!inspectorResizing) return;
    const move = (e: PointerEvent) => {
      const next = window.innerWidth - e.clientX; onInspectorCollapsedChange(false);
      const c = clamp(next, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH);
      if (isChatPage && !sidebarCollapsed && (window.innerWidth - 52 - sidebarWidthRef.current - c) < WORKSPACE_AUTO_COLLAPSE_WIDTH) onSidebarCollapsedChange(true);
      if (next <= INSPECTOR_COLLAPSE_SNAP_WIDTH) { inspectorWidthRef.current = INSPECTOR_MIN_WIDTH; onInspectorWidthChange(INSPECTOR_MIN_WIDTH); onInspectorResizingChange(false); requestAnimationFrame(() => onInspectorCollapsedChange(true)); return; }
      inspectorWidthRef.current = c; onInspectorWidthChange(c);
    };
    const stop = () => { onInspectorResizingChange(false); if (inspectorWidthRef.current <= INSPECTOR_COLLAPSE_SNAP_WIDTH) requestAnimationFrame(() => onInspectorCollapsedChange(true)); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, [inspectorResizing, onInspectorResizingChange, onInspectorCollapsedChange, onInspectorWidthChange, inspectorWidthRef, isChatPage, sidebarCollapsed, sidebarWidthRef, onSidebarCollapsedChange]);

  // Sidebar resize pointer tracking
  useEffect(() => {
    if (!sidebarResizing) return;
    const move = (e: PointerEvent) => {
      const next = e.clientX - 52; onSidebarCollapsedChange(false);
      if (next <= SIDEBAR_COLLAPSE_SNAP_WIDTH) { sidebarShouldCollapseRef.current = true; sidebarWidthRef.current = SIDEBAR_MIN_WIDTH; onSidebarWidthChange(SIDEBAR_MIN_WIDTH); return; }
      sidebarShouldCollapseRef.current = false;
      const c = clamp(next, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
      sidebarWidthRef.current = c; onSidebarWidthChange(c);
    };
    const stop = () => { onSidebarResizingChange(false); if (sidebarShouldCollapseRef.current) { sidebarShouldCollapseRef.current = false; requestAnimationFrame(() => onSidebarCollapsedChange(true)); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, [sidebarResizing, onSidebarResizingChange, onSidebarCollapsedChange, onSidebarWidthChange, sidebarWidthRef, sidebarShouldCollapseRef]);

  const style = { '--inspector-w': `${inspectorWidth}px`, '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties;

  return (
    <div className={styles.shell} data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'} data-inspector-resizing={inspectorResizing ? 'true' : 'false'} data-page={activePage} data-selection-mode={selectionMode ? 'true' : 'false'} data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'} data-sidebar-resizing={sidebarResizing ? 'true' : 'false'} data-testid="agenthub-workbench" style={style}>
      <GlobalRail activePage={activePage} onNavigate={onNavigateRail} onLogout={railProps.onLogout} onToggleTheme={railProps.onToggleTheme} userDisplayName={railProps.userDisplayName} userAvatarUrl={railProps.userAvatarUrl} />
      {isChatPage && (
        <div className={styles.sidebarFrame}>
          <ConversationSidebar {...sidebarProps} />
          <div aria-label="调整最近频道宽度" aria-orientation="vertical" aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuenow={sidebarWidth} className={styles.sidebarResizer} onKeyDown={handleSidebarKeyResize} onPointerDown={(e) => { if (sidebarCollapsed) return; e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); beginSidebarResize(e.clientX); }} role="separator" tabIndex={sidebarCollapsed ? -1 : 0} />
        </div>
      )}
      <main ref={workspaceRef} aria-label="Workspace" className={styles.workspace} data-mainchain={showMainchainStatus ? 'true' : 'false'} data-mode={isChatPage ? 'chat' : 'workbench'} data-surface={surface} data-workspace-main>{children}</main>
      {isChatPage && (
        <RightInspector
          browserPreviewEnabled={inspectorProps.browserPreviewEnabled} canOpenPreview={inspectorProps.canOpenPreview} collapsed={inspectorCollapsed}
          contextBlocks={inspectorProps.contextBlocks} defaultBrowserUrl={inspectorProps.defaultBrowserUrl} deployPreviewUrl={inspectorProps.deployPreviewUrl}
          evidence={inspectorProps.evidence} maxWidth={INSPECTOR_MAX_WIDTH} minWidth={INSPECTOR_MIN_WIDTH} onOpenPreview={inspectorProps.onOpenPreview}
          reviewFileRequest={inspectorProps.reviewFileRequest} routeBlocks={inspectorProps.routeBlocks} runtimeEvidence={inspectorProps.runtimeEvidence}
          runResult={inspectorProps.runResult} workDir={inspectorProps.workDir}
          onResizeBy={inspectorResizeDelegates.onResizeBy} onResizeStart={inspectorResizeDelegates.onResizeStart} width={inspectorWidth}
        />
      )}
      {isChatPage && contextMenu && <ContextMenu groups={contextMenuGroups(contextMenu.blockId)} isOpen title={contextMenu.title} x={contextMenu.x} y={contextMenu.y} onClose={onCloseContextMenu} />}
      {isChatPage && selectionMode && <MultiSelectBar actions={multiSelectActions} count={selectedBlockIds.length} total={totalBlocks} workspaceLeft={selectBarRect?.left} workspaceWidth={selectBarRect?.width} />}
      {activeAgentProfile && <ProfilePopover actions={[{ label: '发送消息' }, { label: 'Agent 配置' }]} anchorElement={activeAgentProfile.anchor} avatar={workbenchProfileInitials(activeAgentProfile.name)} avatarColor={workbenchAgentColor(activeAgentProfile)} badge={statusLabel(activeAgentProfile.state)} isOpen meta={[{ label: '职责', value: activeAgentProfile.role }, { label: '引擎', value: activeAgentProfile.engine }, { label: '模型', value: activeAgentProfile.model }, { label: 'Skills', value: activeAgentProfile.skills.join(' · ') || '未配置' }]} name={activeAgentProfile.name} onAction={onAgentProfileAction} onClose={onCloseAgentProfile} subtitle={`${activeAgentProfile.role} · ${activeAgentProfile.engine}`} variant="agent" />}
      {activeHumanProfile && <ProfilePopover actions={[{ label: '发送消息' }, { label: '复制链接' }]} anchorElement={activeHumanProfile.anchor} avatar={activeHumanProfile.initials} avatarColor={activeHumanProfile.avatarColor ?? 'var(--surface-highest)'} badge={activeHumanProfile.tag} isOpen meta={[{ label: '身份', value: activeHumanProfile.tag }, { label: '组织', value: activeHumanProfile.org }, { label: '状态', value: activeHumanProfile.status }, { label: '最近消息', value: activeHumanProfile.subtitle }]} name={activeHumanProfile.name} onAction={onHumanProfileAction} onClose={onCloseHumanProfile} subtitle={`${activeHumanProfile.tag} · ${activeHumanProfile.org}`} />}
      {activeGroupProfile && <ProfilePopover actions={[{ label: '发送消息' }]} anchorElement={activeGroupProfile.anchor} avatar={workbenchProfileInitials(activeGroupProfile.name)} avatarColor="var(--primary)" badge="群聊" isOpen meta={[{ label: '类型', value: '协作群' }, ...(activeGroupProfile.memberNames.length > 0 ? [{ label: '成员', value: activeGroupProfile.memberNames.join(' · ') }] : [])]} name={activeGroupProfile.name} onAction={onGroupProfileAction} onClose={onCloseGroupProfile} subtitle={activeGroupProfile.memberNames.length > 0 ? `${activeGroupProfile.memberNames.length} 人` : '群聊会话'} variant="group" />}
      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
});
