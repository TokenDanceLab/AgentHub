import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type PropsWithChildren, type MouseEvent } from 'react';
import {
  AssistantRuntimeProvider, useExternalStoreRuntime, useAssistantDataUI,
  useAuiState, MessageNotSentError, type AssistantRuntime, type AttachmentAdapter, type CompleteAttachment,
  type DataMessagePartComponent,
} from '@assistant-ui/react';
import type { AgentHubPlatform } from '../../platform';
import { loadDraft, saveDraft, clearDraft, type ComposerIntent, type ComposerAttachment, type ComposerSubmitResult } from '../../composer';
import type { TranscriptBlock } from '../../transcript';
import { Thread } from './elements/thread.aui';
import { transcriptMessages } from './transcriptMessages';
import { Button } from '../../shadcn/ui/button';
import { Image } from './elements/image';
import type { RowItem } from '../../chatview/types';
import { useAssistantText } from './text';

export type ConversationRuntime = AssistantRuntime;

export interface AssistantConversationProps {
  conversationId: string;
  transcript: TranscriptBlock[];
  platform: AgentHubPlatform;
  intent: Omit<ComposerIntent, 'text' | 'attachments'> & { executionTargetId?: string };
  isLoading?: boolean;
  isDisabled?: boolean;
  isSendDisabled?: boolean;
  isRunning?: boolean;
  onCancel?: () => Promise<void> | void;
  onRuntime?: (runtime: AssistantRuntime | null) => void;
  onSubmitted?: (result: ComposerSubmitResult) => void;
  onEvidenceAction?: (action: string, blockId: string) => void;
  onArtifactClick?: (item: RowItem) => void;
  onCheckpointClick?: (item: RowItem) => void;
  onContextMenu?: (id: string, event: MouseEvent) => void;
  onSelect?: (id: string, shiftKey?: boolean) => void;
  selectedIds?: Set<string>;
  selectionMode?: boolean;
  currentUserId?: string;
  onEdit?: (id: string, text: string) => Promise<void> | void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  submitMode?: 'enter' | 'ctrlEnter';
  controls?: ReactNode;
  welcome?: ReactNode;
}

function hubAttachment(attachment: CompleteAttachment): ComposerAttachment {
  const part = attachment.content.find((part) => part.type === 'data' && part.name === 'agenthub-attachment');
  if (!part || part.type !== 'data') throw new Error('Attachment has no Hub reference');
  return part.data as ComposerAttachment;
}

function createAttachmentAdapter(platform: AgentHubPlatform): AttachmentAdapter | undefined {
  const port = platform.attachments;
  if (!port) return undefined;
  return {
    accept: '*',
    async add({ file }) {
      return { id: crypto.randomUUID(), type: file.type.startsWith('image/') ? 'image' : 'file',
        name: file.name, contentType: file.type, file,
        status: { type: 'requires-action', reason: 'composer-send' } };
    },
    async send(attachment) {
      const ref = await port.uploadAttachment(attachment.file);
      return { ...attachment, status: { type: 'complete' }, content: [{ type: 'data', name: 'agenthub-attachment',
        data: { id: ref.id, name: ref.name, attachmentRef: ref, size: ref.size, mime: ref.mime_type } }] };
    },
    async remove() { /* Removing a draft does not delete an uploaded server attachment. */ },
  };
}

/** Mount with the conversation ID as key: pending callbacks and drafts cannot cross threads. */
export function AssistantConversation(props: AssistantConversationProps) {
  const t = useAssistantText();
  const { transcript, platform, intent, onRuntime } = props;
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingDispatch, setPendingDispatch] = useState<{ messageId: string; intent: ComposerIntent; error?: string } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const messages = useMemo(() => transcriptMessages(transcript), [transcript]);
  const attachments = useMemo(() => createAttachmentAdapter(platform), [platform]);
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isLoading: props.isLoading ?? false,
    isDisabled: props.isDisabled ?? false,
    isRunning: props.isRunning ?? false,
    isSendDisabled: props.isSendDisabled || props.isLoading || props.isRunning || sending,
    adapters: { attachments },
    onCancel: props.onCancel ? async () => { await props.onCancel?.(); } : undefined,
    onEdit: props.onEdit ? async (message) => {
      if (!message.sourceId) return;
      const source = transcript.find((block) => block.id === message.sourceId);
      if (!source || source.author.role !== 'human' || source.author.id !== props.currentUserId) throw new Error('Only your own messages can be edited');
      await props.onEdit?.(message.sourceId, message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'));
    } : undefined,
    async onNew(message) {
      setError(null);
      setSending(true);
      try {
        const payload = { ...intent,
          text: message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'),
          attachments: (message.role === 'user' ? message.attachments ?? [] : []).map(hubAttachment),
          ...(message.metadata.custom?.quote ? { quote: message.metadata.custom.quote as { text: string; messageId: string } } : {}),
        };
        const result = await platform.runs.submitComposerIntent(payload);
        if (result.dispatchError || result.turnInProgress) setPendingDispatch({ messageId: result.intentId, intent: payload, error: result.dispatchError });
        props.onSubmitted?.(result);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to send message');
        throw new MessageNotSentError(cause instanceof Error ? cause.message : 'Unable to send message');
      } finally {
        setSending(false);
      }
    },
  });
  useEffect(() => {
    onRuntime?.(runtime);
    return () => onRuntime?.(null);
  }, [runtime, onRuntime]);
  const initialized = useRef(false);
  useEffect(() => {
    const composer = runtime.thread.composer;
    if (!initialized.current) {
      initialized.current = true;
      const draft = loadDraft(props.conversationId);
      if (draft) {
        composer.setText(draft.text);
        for (const attachment of draft.attachments ?? []) {
          void composer.addAttachment({ id: attachment.id, type: attachment.mime?.startsWith('image/') ? 'image' : 'file', name: attachment.name,
            content: [{ type: 'data', name: 'agenthub-attachment', data: attachment }] });
        }
      }
    }
    return composer.subscribe(() => {
      const state = composer.getState();
      const attachments = state.attachments.filter((attachment): attachment is CompleteAttachment => attachment.status.type === 'complete')
        .map(hubAttachment).flatMap((attachment) => attachment.attachmentRef ? [{ ...attachment, attachmentRef: attachment.attachmentRef }] : []);
      if (state.text || attachments.length) saveDraft(props.conversationId, { text: state.text, mentions: [], attachments });
      else clearDraft(props.conversationId);
    });
  }, [runtime, props.conversationId]);
  const components = useMemo(() => ({
    MessageHeader: MessageAuthor,
    MessageFrame,
    UserActions: OwnMessageActions,
    ComposerControls: () => <>{props.controls}{error && <p role="alert" className="text-destructive px-2 text-sm">{error}</p>}
      {pendingDispatch && <div role="status" className="px-2 text-sm">
        <p>{t('Message sent; the agent has not started.')}{pendingDispatch.error}</p>
        {platform.runs.redispatchTask && <Button type="button" variant="outline" size="sm" disabled={retrying || props.isRunning}
          onClick={async () => {
            setRetrying(true);
            try {
              const result = await platform.runs.redispatchTask?.(pendingDispatch.intent, pendingDispatch.messageId);
              if (!result?.turnInProgress) setPendingDispatch(null);
            } catch (cause) {
              setPendingDispatch({ ...pendingDispatch, error: cause instanceof Error ? cause.message : 'Agent dispatch failed' });
            } finally { setRetrying(false); }
          }}>{t('Retry agent')}</Button>}
      </div>}
    </>,
    Welcome: () => <div className="mb-6 px-2 text-lg font-medium">{props.welcome}</div>,
  }), [props.controls, props.welcome, props.isRunning, error, pendingDispatch, retrying, platform, t]);
  return <AssistantRuntimeProvider runtime={runtime}>
    <ConversationContext.Provider value={props}>
      <EvidenceUI />
      <Thread components={components} inputRef={props.inputRef} submitMode={props.submitMode} hideComposer={props.selectionMode} />
    </ConversationContext.Provider>
  </AssistantRuntimeProvider>;
}

const ConversationContext = createContext<AssistantConversationProps | null>(null);

function OwnMessageActions({ children }: PropsWithChildren) {
  const props = useContext(ConversationContext);
  const author = useAuiState((state) => state.message.metadata.custom.author) as { id: string; role: string } | undefined;
  return author?.role === 'human' && author.id === props?.currentUserId ? <>{children}</> : null;
}

function MessageFrame({ children }: PropsWithChildren) {
  const props = useContext(ConversationContext);
  const id = useAuiState((state) => state.message.id);
  const author = useAuiState((state) => state.message.metadata.custom.author) as { id: string; role: string } | undefined;
  const ownMessage = author?.role === 'human' && author.id === props?.currentUserId;
  return <div data-block-id={id} data-selectable-card={id} data-own-message={ownMessage} tabIndex={0}
    data-selected={props?.selectedIds?.has(id)} className="min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-accent"
    onContextMenu={(event) => props?.onContextMenu?.(id, event)}
    onClick={(event) => { if (props?.selectionMode) props.onSelect?.(id, event.shiftKey); }}
    onKeyDown={(event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        props?.onContextMenu?.(id, { preventDefault: () => {}, clientX: rect.left + 16, clientY: rect.top + 16 } as MouseEvent);
      }
      if (props?.selectionMode && event.key === ' ') { event.preventDefault(); props.onSelect?.(id, event.shiftKey); }
    }}>{children}</div>;
}

function MessageAuthor() {
  const author = useAuiState((state) => state.message.metadata.custom.author) as { name: string; role: string } | undefined;
  const id = useAuiState((state) => state.message.id);
  return <div id={id} className="text-muted-foreground mb-1 px-2 text-xs" data-author-role={author?.role}>{author?.name}</div>;
}

function EvidenceUI() {
  const props = useContext(ConversationContext);
  const onAction = props?.onEvidenceAction;
  const render = useMemo<DataMessagePartComponent>(() => ({ data }) => {
    const block = data as TranscriptBlock;
    if (block.kind === 'permission_request') {
      return <div className="rounded-lg border p-3">
        <p className="font-medium">{block.title}</p><p>{block.reason}</p>
        {onAction && <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onAction('approve', block.id)}>允许 / Allow</Button>
          <Button size="sm" variant="outline" onClick={() => onAction('deny', block.id)}>拒绝 / Deny</Button>
        </div>}
      </div>;
    }
    if (block.kind === 'attachment') return <AttachmentEvidence block={block} platform={props?.platform} />;
    if (block.kind === 'checkpoint') return <Button variant="outline" onClick={() => props?.onCheckpointClick?.({ checkpointRunId: block.runId } as RowItem)}>Checkpoint</Button>;
    if (block.kind === 'artifact') return <Button variant="outline" onClick={() => props?.onArtifactClick?.({ artifactId: block.artifactId, artifactPath: block.path,
      artifactRunId: block.evidenceRefs?.find((ref) => ref.kind === 'run')?.id.replace(/^run-/, '') } as RowItem)}>{block.title}</Button>;
    const title = 'title' in block ? block.title : 'toolName' in block ? block.toolName : block.kind;
    const detail = 'reason' in block ? block.reason : 'summary' in block ? block.summary : 'path' in block ? block.path : undefined;
    return <div className="rounded-lg border p-3 text-sm"><p className="font-medium">{title}</p>{detail && <p>{detail}</p>}</div>;
  }, [onAction, props]);
  useAssistantDataUI({ name: 'agenthub-evidence', render });
  return null;
}

function AttachmentEvidence({ block, platform }: { block: Extract<TranscriptBlock, { kind: 'attachment' }>; platform: AgentHubPlatform | undefined }) {
  const [url, setUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const resolve = platform?.preview?.resolveAttachmentImageUrl;
    setUrl(undefined);
    if (block.contentType === 'image' && resolve) {
      setLoading(true);
      void resolve(block.attachmentRef).then((next) => { if (active) setUrl(next); })
        .catch(() => {}).finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [block.attachmentRef, block.contentType, platform]);
  if (url) return <Image type="image" image={url} filename={block.attachmentRef.name} status={{ type: 'complete' }} />;
  return <div className="rounded-lg border p-3 text-sm">{block.attachmentRef.name}{loading ? ' · Loading…' : block.contentType === 'image' ? ' · Preview unavailable' : ''}</div>;
}
