import React, { FormEvent, useReducer } from 'react';
import {
  buildComposerIntent,
  canSubmitComposer,
  composerReducer,
  createInitialComposerState,
} from '../composer';
import type { AgentHubPlatform, WorkbenchConversation } from '../platform';
import { collectTranscriptEvidence } from '../transcript';
import type { EvidenceRef, TranscriptBlock } from '../transcript';
import styles from './AgentHubWorkbench.module.css';

export interface AgentHubWorkbenchProps {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  activeConversationId?: string;
  transcript: TranscriptBlock[];
}

export function AgentHubWorkbench({
  platform,
  conversations,
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

  async function submitComposer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmitComposer(composer)) return;

    dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });
    await platform.runs.submitComposerIntent(buildComposerIntent(composer));
    dispatchComposer({ type: 'resetAfterSubmit' });
  }

  return (
    <div className={styles.shell}>
      <nav aria-label="Global rail" className={styles.rail}>
        <span aria-hidden="true" className={styles.mark}>AH</span>
      </nav>

      <aside aria-label="Conversation sidebar" className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Conversations</h2>
        <ul className={styles.conversationList}>
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                aria-current={conversation.id === currentConversationId}
                className={styles.conversationButton}
                type="button"
              >
                <span className={styles.conversationTitle}>{conversation.title}</span>
                {conversation.subtitle ? (
                  <span className={styles.conversationSubtitle}>{conversation.subtitle}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main aria-label="Workspace" className={styles.workspace} data-surface={platform.surface}>
        <div className={styles.toolbar}>
          <button
            className={styles.previewButton}
            disabled={!platform.capabilities.browserPreview}
            type="button"
          >
            浏览器预览
          </button>
        </div>

        <section aria-label="Transcript" className={styles.transcriptRegion}>
          <ol className={styles.transcript}>
            {transcript.map((block) => (
              <li className={styles.block} key={block.id}>
                <span className={styles.blockAuthor}>{block.author.name}</span>
                {renderTranscriptBlock(block)}
              </li>
            ))}
          </ol>
        </section>

        <form className={styles.composer} onSubmit={submitComposer}>
          <textarea
            aria-label="Composer input"
            className={styles.composerInput}
            onChange={(event) => dispatchComposer({ type: 'setText', text: event.target.value })}
            value={composer.text}
          />
          <button
            className={styles.sendButton}
            disabled={!canSubmitComposer(composer) || composer.submitState === 'submitting'}
            type="submit"
          >
            发送消息
          </button>
        </form>
      </main>

      <aside aria-label="Right inspector" className={styles.inspector}>
        <h2 className={styles.inspectorTitle}>Evidence</h2>
        <ul className={styles.evidenceList}>
          {evidence.map((item) => (
            <li className={styles.evidenceItem} key={item.id}>
              {renderEvidence(item)}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function renderTranscriptBlock(block: TranscriptBlock): React.ReactElement {
  switch (block.kind) {
    case 'text':
      return <p className={styles.blockText}>{block.text}</p>;
    case 'tool_call':
      return (
        <p className={styles.blockTitle}>
          {block.toolName}
          <span className={styles.blockMeta}> · {block.status}</span>
        </p>
      );
    case 'artifact':
    case 'diff':
    case 'approval':
      return <p className={styles.blockTitle}>{block.title}</p>;
  }
}

function renderEvidence(item: EvidenceRef): React.ReactElement {
  return (
    <>
      <span className={styles.evidenceLabel}>{item.label}</span>
      <span className={styles.blockMeta}>{item.kind}</span>
    </>
  );
}
