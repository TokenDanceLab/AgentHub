import { useCallback, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Code2, Copy, FileText, GitPullRequestArrow, MessageSquareText, RefreshCw, Reply, SendHorizonal, Share, ShieldAlert, X, XCircle } from "lucide-react";
import type { Approval, Run, Thread, ThreadItem } from "@agenthub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createThreadMessage, decideApproval, listApprovals, listRuns, listThreadItems } from "@agenthub/shared";
import { ActionList, ActivityCard, BottomSheet, ContextSummary, EmptyState, MessageBubble, StatusNotice } from "@agenthub/shared/ui";
import { useTranslation } from "react-i18next";
import { MobileRecoveryPanel } from "../components/MobileRecoveryPanel";
import { usePullDownGesture } from "../hooks/useSwipeableMessage";
import { SwipeableMessageRow } from "../hooks/SwipeableMessageRow";
import { useKeyboardAvoidance } from "../hooks/useKeyboardAvoidance";

interface ChatViewProps {
  thread: Thread;
  onBack: () => void;
}

type ActivityKind = Exclude<ThreadItem["kind"], "message">;
type LocalReplyStatus = "sending" | "failed" | "sent";

export function ChatView({ thread, onBack }: ChatViewProps) {
  const { t, i18n } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [showLatestJump, setShowLatestJump] = useState(false);
  const [localReply, setLocalReply] = useState<{ content: string; status: LocalReplyStatus } | null>(null);
  const [replyTarget, setReplyTarget] = useState<ThreadItem | null>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<ThreadItem | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const queryClient = useQueryClient();

  // Keyboard avoidance — detect soft keyboard via Visual Viewport API
  const { isKeyboardVisible, keyboardHeight } = useKeyboardAvoidance();

  // ─── Inline approval state ───
  const [localDecisionStatus, setLocalDecisionStatus] = useState<"approved" | "rejected" | null>(null);

  const runs = useQuery({
    queryKey: ["runs", thread.id],
    queryFn: () => listRuns({ threadId: thread.id }),
    refetchInterval: 5000,
  });

  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: listApprovals,
  });

  const pendingRun = runs.data?.items.find((r) => r.status === "waiting_approval") ?? null;
  const pendingApproval = pendingRun
    ? approvals.data?.items.find((a) => a.runId === pendingRun.runId && a.status === "pending") ?? null
    : null;
  const decisionStatus = localDecisionStatus ?? pendingApproval?.status;

  const decideApprovalMutation = useMutation({
    mutationFn: async ({ approvalId, decision }: { approvalId: string; decision: "approved" | "rejected" }) => {
      return decideApproval(approvalId, { decision });
    },
    onSuccess: (_result, variables) => {
      setLocalDecisionStatus(variables.decision);
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["runs", thread.id] });
      void queryClient.invalidateQueries({ queryKey: ["thread-items", thread.id] });
    },
  });

  const messages = useQuery({
    queryKey: ["thread-items", thread.id],
    queryFn: () => listThreadItems(thread.id, { pageSize: 100 }),
  });

  const sendMessage = useMutation({
    mutationFn: (content: string) => createThreadMessage(thread.id, { role: "user", content }),
  });

  const submitReply = useCallback((content: string) => {
    if (!content || sendMessage.isPending) return;
    setLocalReply({ content, status: "sending" });
    setInputValue("");
    sendMessage.mutate(content, {
      onSuccess: () => {
        setLocalReply({ content, status: "sent" });
        void queryClient.invalidateQueries({ queryKey: ["thread-items", thread.id] });
        void queryClient.invalidateQueries({ queryKey: ["threads"] });
      },
      onError: () => {
        setInputValue(content);
        setLocalReply({ content, status: "failed" });
      },
    });
  }, [queryClient, sendMessage, thread.id]);

  const handleSend = useCallback(() => {
    submitReply(inputValue.trim());
  }, [inputValue, submitReply]);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setShowLatestJump(distanceFromBottom > 180);
  }, []);

  const jumpToLatest = useCallback(() => {
    latestRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    setShowLatestJump(false);
  }, []);

  // ─── Pull-down-to-refresh ───
  const pullDownHandlers = usePullDownGesture(scrollRef, () => {
    void messages.refetch();
  }, messages.isFetching);

  // ─── Long-press context menu ───
  function openContextMenu(item: ThreadItem) {
    setContextMenuTarget(item);
  }

  function closeContextMenu() {
    setContextMenuTarget(null);
  }

  function handleSwipeReply(item: ThreadItem) {
    setReplyTarget(item);
  }

  function handleForward(item: ThreadItem) {
    navigator.clipboard.writeText(item.content).catch(() => {});
    setCopiedItemId(item.id);
    window.setTimeout(() => setCopiedItemId(null), 1400);
  }

  // ─── Keyboard avoidance: scroll the textarea into view on focus ───
  const handleTextareaFocus = useCallback(() => {
    // Delay slightly so the soft keyboard animation can start,
    // then scroll the composer into the visible area.
    window.setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.scrollIntoView({ block: "end", behavior: "smooth" });
      }
    }, 120);
  }, []);

  const visibleItems = useMemo(
    () => (messages.data?.items ?? []).filter((item) => item.content.trim()),
    [messages.data?.items],
  );
  const visibleMessageCount = visibleItems.filter((item) => item.kind === "message").length;

  async function copyContent(item: ThreadItem) {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopiedItemId(item.id);
      window.setTimeout(() => setCopiedItemId(null), 1400);
    } catch {
      setCopiedItemId(null);
    }
  }

  function renderItem(item: ThreadItem) {
    if (item.kind !== "message") {
      return renderActivityItem(item);
    }

    const isUser = item.role === "user";

    return (
      <SwipeableMessageRow
        key={item.id}
        isUser={isUser}
        onReply={() => handleSwipeReply(item)}
        onCopy={() => { void copyContent(item); }}
        onForward={() => { handleForward(item); }}
        onLongPress={() => { openContextMenu(item); }}
      >
        <MessageBubble
          className={`mobileMessageRow${isUser ? " mobileMessageRowUser" : ""}`}
          bubbleClassName={`mobileMessage ${isUser ? "mobileUserMsg" : "mobileAgentMsg"}`}
          metaClassName="mobileMessageMeta"
          actionsClassName="mobileMessageActions"
          align={isUser ? "end" : "start"}
          author={isUser ? t("chat.participants.user") : t("chat.participants.agent")}
          timestamp={new Date(item.createdAt).toLocaleTimeString(i18n.resolvedLanguage || i18n.language, { hour: "2-digit", minute: "2-digit" })}
          actions={(
            <button
              className="mobileMessageAction"
              type="button"
              onClick={() => void copyContent(item)}
              aria-label={isUser ? t("chat.actions.copyUser") : t("chat.actions.copyAgent")}
            >
              <Copy size={14} />
              <span>{copiedItemId === item.id ? t("chat.actions.copied") : t("chat.actions.copy")}</span>
            </button>
          )}
        >
          {item.content}
        </MessageBubble>
      </SwipeableMessageRow>
    );
  }

  function renderActivityItem(item: ThreadItem) {
    const activityMeta: Record<ActivityKind, { icon: typeof CheckCircle2; label: string }> = {
      approval: { icon: CheckCircle2, label: t("chat.activity.approval") },
      diff: { icon: GitPullRequestArrow, label: t("chat.activity.diff") },
      code: { icon: Code2, label: t("chat.activity.code") },
      file: { icon: FileText, label: t("chat.activity.file") },
    };
    const meta = activityMeta[item.kind as ActivityKind];
    const Icon = meta.icon;
    const isApproval = item.kind === "approval" && pendingRun && pendingApproval;
    const isDecided = decisionStatus === "approved" || decisionStatus === "rejected";
    const buttonDisabled = decideApprovalMutation.isPending || isDecided;

    return (
      <ActivityCard
        key={item.id}
        className="mobileActivityCard"
        iconClassName="mobileActivityIcon"
        bodyClassName="mobileActivityBody"
        metaClassName="mobileActivityMeta"
        actionsClassName="mobileActivityActions"
        label={meta.label}
        meta={<time>{new Date(item.createdAt).toLocaleTimeString(i18n.resolvedLanguage || i18n.language, { hour: "2-digit", minute: "2-digit" })}</time>}
        icon={<Icon size={16} />}
        actions={isApproval ? (
          <div className="mobileInlineApprovalActions">
            {isDecided ? (
              <StatusNotice
                className="mobileSignalRow"
                icon={decisionStatus === "approved" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              >
                {decisionStatus === "approved" ? t("runDetail.review.decisionApproved") : t("runDetail.review.decisionRejected")}
              </StatusNotice>
            ) : (
              <>
                <button
                  className="mobileActionButton"
                  type="button"
                  disabled={buttonDisabled}
                  onClick={() => decideApprovalMutation.mutate({ approvalId: pendingApproval.id, decision: "approved" })}
                >
                  {decideApprovalMutation.isPending ? <RefreshCw size={14} className="mobileSpin" /> : <CheckCircle2 size={14} />}
                  <span>{t("runDetail.actions.approve")}</span>
                </button>
                <button
                  className="mobileActionButton mobileDangerAction"
                  type="button"
                  disabled={buttonDisabled}
                  onClick={() => decideApprovalMutation.mutate({ approvalId: pendingApproval.id, decision: "rejected" })}
                >
                  <XCircle size={14} />
                  <span>{t("runDetail.actions.reject")}</span>
                </button>
              </>
            )}
          </div>
        ) : undefined}
      >
        {item.content}
      </ActivityCard>
    );
  }

  return (
    <div className="mobileView mobileChatView">
      <header className="mobileHeader mobileChatHeader">
        <button
          onClick={onBack}
          className="mobileIconButton"
          type="button"
          aria-label={t("chat.actions.backToThreads")}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="mobileHeaderTitle">
          <p className="mobileEyebrow">{thread.projectId || t("chat.context.fallbackProject")}</p>
          <h1>{thread.title || thread.id}</h1>
        </div>
      </header>

      {pendingRun && pendingApproval && decisionStatus !== "approved" && decisionStatus !== "rejected" && (
        <div className="mobileApprovalBar">
          <ShieldAlert size={16} />
          <span className="mobileApprovalBarSummary">{pendingApproval.summary || t("runDetail.review.pending")}</span>
          <div className="mobileApprovalBarActions">
            <button
              className="mobileActionButton"
              type="button"
              disabled={decideApprovalMutation.isPending}
              onClick={() => decideApprovalMutation.mutate({ approvalId: pendingApproval.id, decision: "approved" })}
            >
              {decideApprovalMutation.isPending ? <RefreshCw size={14} className="mobileSpin" /> : <CheckCircle2 size={14} />}
              <span>{t("runDetail.actions.approve")}</span>
            </button>
            <button
              className="mobileActionButton mobileDangerAction"
              type="button"
              disabled={decideApprovalMutation.isPending}
              onClick={() => decideApprovalMutation.mutate({ approvalId: pendingApproval.id, decision: "rejected" })}
            >
              <XCircle size={14} />
              <span>{t("runDetail.actions.reject")}</span>
            </button>
          </div>
        </div>
      )}

      <div
        className={`mobileScroll mobileChatScroll${isKeyboardVisible ? " mobileKeyboardVisible" : ""}`}
        ref={scrollRef}
        onScroll={handleScroll}
        {...pullDownHandlers}
      >
        <ContextSummary
          className="mobileChatContextPanel"
          eyebrowClassName="mobileEyebrow"
          eyebrow={t("chat.context.eyebrow")}
          title={thread.title || t("chat.context.fallbackTitle")}
          items={[
            { id: "status", label: t("chat.context.status"), value: thread.status },
            { id: "messages", label: t("chat.context.messages"), value: visibleMessageCount },
            {
              id: "updated",
              label: t("chat.context.updated"),
              value: new Date(thread.updatedAt ?? thread.createdAt).toLocaleString(i18n.resolvedLanguage || i18n.language, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
          ]}
        />

        {messages.isLoading && (
          <div className="mobileCenterState">
            <RefreshCw size={24} className="mobileSpin" />
            <strong>{t("chat.states.loadingTitle")}</strong>
            <p>{t("chat.states.loadingDescription")}</p>
          </div>
        )}

        {messages.isError && (
          <MobileRecoveryPanel
            icon={<AlertCircle size={18} />}
            eyebrow={t("chat.states.syncErrorEyebrow")}
            title={t("chat.states.syncErrorTitle")}
            description={t("chat.states.syncErrorDescription")}
            meta={t("chat.states.replyPaused")}
            isRetrying={messages.isFetching}
            onRetry={() => messages.refetch()}
            secondaryLabel={t("chat.actions.threads")}
            secondaryIcon={<ArrowLeft size={16} />}
            onSecondaryAction={onBack}
          />
        )}

        {!messages.isLoading && !messages.isError && visibleItems.length === 0 && (
          <EmptyState
            className="mobileCenterState"
            contentClassName="mobileCenterStateContent"
            iconClassName="mobileEmptyIcon"
            titleClassName="mobileCenterStateTitle"
            descriptionClassName="mobileCenterStateDescription"
            title={t("chat.states.emptyTitle")}
            description={t("chat.states.emptyDescription")}
            icon={<MessageSquareText size={24} />}
          />
        )}

        <div className="mobileMessageList">
          {visibleItems.map(renderItem)}
          {localReply && (
            <MessageBubble
              className="mobileMessageRow mobileMessageRowUser"
              bubbleClassName={`mobileMessage mobileUserMsg${localReply.status === "sending" ? " mobilePendingMsg" : ""}${localReply.status === "failed" ? " mobileFailedMsg" : ""}`}
              metaClassName="mobileMessageMeta"
              align="end"
              author={t("chat.participants.user")}
              timestamp={
                localReply.status === "sending"
                  ? t("chat.actions.sending")
                  : localReply.status === "failed"
                    ? t("chat.actions.notSent")
                    : t("chat.actions.sent")
              }
            >
              {localReply.content}
            </MessageBubble>
          )}
          <div ref={latestRef} aria-hidden="true" />
        </div>
      </div>

      {showLatestJump && (
        <button
          className="mobileLatestJump"
          type="button"
          aria-label={t("chat.actions.jumpToLatest")}
          onClick={jumpToLatest}
        >
          {t("chat.actions.latest")}
        </button>
      )}

      <form
        className={`mobileComposerDock${messages.isError ? " mobileComposerDockPaused" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
      >
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onFocus={handleTextareaFocus}
          aria-label={t("chat.composer.label")}
          placeholder={messages.isError ? t("chat.states.replyPaused") : t("chat.composer.placeholder")}
          rows={2}
          disabled={sendMessage.isPending || messages.isError}
        />
        <button
          className="mobileSendButton"
          type="submit"
          aria-label={messages.isError ? t("chat.actions.replyPaused") : t("chat.actions.sendMobileReply")}
          disabled={!inputValue.trim() || sendMessage.isPending || messages.isError}
        >
          {sendMessage.isPending ? <RefreshCw size={17} className="mobileSpin" /> : <SendHorizonal size={17} />}
          <span>
            {messages.isError
              ? t("chat.actions.paused")
              : sendMessage.isPending
                ? t("chat.actions.sending")
                : t("chat.actions.send")}
          </span>
        </button>
        {sendMessage.isPending && (
          <StatusNotice className="mobileComposerStatus">{t("chat.states.sendingReply")}</StatusNotice>
        )}
        {sendMessage.isError && (
          <StatusNotice
            className="mobileComposerStatus mobileComposerError"
            action={(
              <button
                className="mobileActionButton"
                type="button"
                aria-label={t("chat.actions.retryMobileReply")}
                disabled={sendMessage.isPending || !localReply?.content}
                onClick={() => {
                  if (localReply?.content) {
                    submitReply(localReply.content);
                  }
                }}
              >
                <RefreshCw size={15} />
                <span>{t("chat.actions.retry")}</span>
              </button>
            )}
          >
            {t("chat.states.replyStayed")}
          </StatusNotice>
        )}
      </form>

      {/* ─── Long-press context menu ─── */}
      {contextMenuTarget && (
        <BottomSheet
          ariaLabel={t("chat.sheets.contextActions")}
          title={t("chat.sheets.contextActions")}
          closeLabel={t("chat.sheets.closeSheet")}
          onClose={closeContextMenu}
          sheetClassName="mobileBottomSheet"
          scrimClassName="mobileSheetScrim"
          layerClassName="mobileSheetLayer"
          handleClassName="mobileSheetHandle"
          headerClassName="mobileSheetHeader"
        >
          <ActionList
            items={[
              {
                id: "reply",
                title: t("chat.actions.reply"),
                icon: <Reply size={15} />,
                onClick: () => { handleSwipeReply(contextMenuTarget); closeContextMenu(); },
              },
              ...(contextMenuTarget.role === "user"
                ? []
                : [{
                  id: "copy",
                  title: t("chat.actions.copy"),
                  icon: <Copy size={15} />,
                  onClick: () => { void copyContent(contextMenuTarget); closeContextMenu(); },
                }]
              ),
              {
                id: "forward",
                title: t("chat.actions.forward"),
                icon: <Share size={15} />,
                onClick: () => { handleForward(contextMenuTarget); closeContextMenu(); },
              },
            ]}
          />
        </BottomSheet>
      )}

      {/* ─── Reply target indicator ─── */}
      {replyTarget && (
        <div
          className="mobileReplyIndicator"
          role="status"
          aria-live="polite"
        >
          <span>
            {t("chat.replyIndicator.prefix", { author: replyTarget.role === "user" ? t("chat.participants.user") : t("chat.participants.agent") })}
          </span>
          <button
            className="mobileIconButton"
            type="button"
            aria-label={t("chat.replyIndicator.dismiss")}
            onClick={() => setReplyTarget(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
