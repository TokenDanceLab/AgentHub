import React, { FormEvent, useReducer } from 'react';
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

  return (
    <div className={styles.shell}>
      <GlobalRail />
      <ConversationSidebar
        activeConversationId={currentConversationId}
        conversations={conversations}
      />

      <main aria-label="Workspace" className={styles.workspace} data-surface={platform.surface}>
        <WorkspaceHeader
          activeConversation={activeConversation}
          browserPreviewEnabled={platform.capabilities.browserPreview}
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
        evidence={evidence}
        onOpenPreview={platform.preview?.openEvidence}
      />
    </div>
  );
}
