import React, { FormEvent, useEffect, useReducer, useState } from 'react';
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
import { GlobalRail } from './GlobalRail';
import { RightInspector } from './RightInspector';
import { TranscriptView } from './TranscriptView';
import { UnifiedComposer } from './UnifiedComposer';
import { WorkspaceHeader } from './WorkspaceHeader';
import styles from './AgentHubWorkbench.module.css';

const INSPECTOR_MIN_WIDTH = 300;
const INSPECTOR_MAX_WIDTH = 760;
const INSPECTOR_COLLAPSE_WIDTH = 220;
const INSPECTOR_RESTORE_WIDTH = 260;
const INSPECTOR_DEFAULT_WIDTH = 400;

export interface AgentHubWorkbenchProps {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  agents?: WorkbenchAgent[];
  activeConversationId?: string;
  transcript: TranscriptBlock[];
}

export function AgentHubWorkbench({
  platform,
  conversations,
  agents = [],
  activeConversationId,
  transcript,
}: AgentHubWorkbenchProps): React.ReactElement {
  const fallbackConversationId = conversations[0]?.id ?? 'default';
  const currentConversationId = activeConversationId ?? fallbackConversationId;
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [inspectorResizing, setInspectorResizing] = useState(false);
  const [composer, dispatchComposer] = useReducer(
    composerReducer,
    currentConversationId,
    createInitialComposerState,
  );
  const evidence = collectTranscriptEvidence(transcript);
  const activeConversation = conversations.find((conversation) => conversation.id === currentConversationId);
  const mentionableAgents: ComposerMention[] = agents.map((agent) => ({
    id: agent.id,
    label: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.status ? { status: agent.status } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.runtimeId ? { runtimeId: agent.runtimeId } : {}),
  }));

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

  const shellStyle = {
    '--ahv4-inspector-width': `${inspectorWidth}px`,
  } as React.CSSProperties;

  return (
    <div
      className={styles.shell}
      data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}
      data-inspector-resizing={inspectorResizing ? 'true' : 'false'}
      data-testid="agenthub-workbench"
      style={shellStyle}
    >
      <GlobalRail />
      <ConversationSidebar
        activeConversationId={currentConversationId}
        conversations={conversations}
      />

      <main aria-label="Workspace" className={styles.workspace} data-surface={platform.surface}>
        <WorkspaceHeader
          activeConversation={activeConversation}
          browserPreviewEnabled={platform.capabilities.browserPreview}
          inspectorCollapsed={inspectorCollapsed}
          onToggleInspector={() => setInspectorCollapsed((collapsed) => !collapsed)}
        />
        <TranscriptView transcript={transcript} />
        <UnifiedComposer
          composer={composer}
          dispatchComposer={dispatchComposer}
          mentionableAgents={mentionableAgents}
          onPickLocalAttachments={platform.attachments?.pickFiles}
          onSubmit={submitComposer}
        />
      </main>

      <RightInspector
        browserPreviewEnabled={platform.capabilities.browserPreview}
        canOpenPreview={platform.preview?.canOpenEvidence}
        collapsed={inspectorCollapsed}
        evidence={evidence}
        maxWidth={INSPECTOR_MAX_WIDTH}
        minWidth={INSPECTOR_MIN_WIDTH}
        onOpenPreview={platform.preview?.openEvidence}
        onResizeBy={resizeInspectorBy}
        onResizeStart={beginInspectorResize}
        width={inspectorWidth}
      />
    </div>
  );
}
