import { useCallback, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Code2, Copy, FileText, GitPullRequestArrow, RefreshCw, SendHorizonal } from "lucide-react";
import type { Thread, ThreadItem } from "@agenthub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createThreadMessage, listThreadItems } from "@agenthub/shared";
import { useTranslation } from "react-i18next";
import { MobileRecoveryPanel } from "../components/MobileRecoveryPanel";

interface ChatViewProps {
  thread: Thread;
  onBack: () => void;
}

type ActivityKind = Exclude<ThreadItem["kind"], "message">;
type LocalReplyStatus = "sending" | "failed" | "sent";

export function ChatView({ thread, onBack }: ChatViewProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [showLatestJump, setShowLatestJump] = useState(false);
  const [localReply, setLocalReply] = useState<{ content: string; status: LocalReplyStatus } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

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
      <article
        key={item.id}
        className={`mobileMessageRow${isUser ? " mobileMessageRowUser" : ""}`}
      >
        <div className={`mobileMessage ${isUser ? "mobileUserMsg" : "mobileAgentMsg"}`}>
          <div className="mobileMessageMeta">
            <strong>{isUser ? t("chat.participants.user") : t("chat.participants.agent")}</strong>
            <time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            <button
              className="mobileMessageAction"
              type="button"
              onClick={() => void copyContent(item)}
              aria-label={isUser ? t("chat.actions.copyUser") : t("chat.actions.copyAgent")}
            >
              <Copy size={14} />
              <span>{copiedItemId === item.id ? t("chat.actions.copied") : t("chat.actions.copy")}</span>
            </button>
          </div>
          <p>{item.content}</p>
        </div>
      </article>
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

    return (
      <article className="mobileActivityCard" key={item.id}>
        <span className="mobileActivityIcon">
          <Icon size={16} />
        </span>
        <span className="mobileActivityBody">
          <span className="mobileActivityMeta">
            <strong>{meta.label}</strong>
            <time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          </span>
          <span>{item.content}</span>
        </span>
      </article>
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

      <div className="mobileScroll mobileChatScroll" ref={scrollRef} onScroll={handleScroll}>
        <section className="mobileChatContextPanel">
          <div>
            <p className="mobileEyebrow">{t("chat.context.eyebrow")}</p>
            <h2>{thread.title || t("chat.context.fallbackTitle")}</h2>
          </div>
          <dl>
            <div>
              <dt>{t("chat.context.status")}</dt>
              <dd>{thread.status}</dd>
            </div>
            <div>
              <dt>{t("chat.context.messages")}</dt>
              <dd>{visibleMessageCount}</dd>
            </div>
            <div>
              <dt>{t("chat.context.updated")}</dt>
              <dd>
                {new Date(thread.updatedAt ?? thread.createdAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </dd>
            </div>
          </dl>
        </section>

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
          <div className="mobileCenterState">
            <strong>{t("chat.states.emptyTitle")}</strong>
            <p>{t("chat.states.emptyDescription")}</p>
          </div>
        )}

        <div className="mobileMessageList">
          {visibleItems.map(renderItem)}
          {localReply && (
            <article className="mobileMessageRow mobileMessageRowUser">
              <div className={`mobileMessage mobileUserMsg${localReply.status === "sending" ? " mobilePendingMsg" : ""}${localReply.status === "failed" ? " mobileFailedMsg" : ""}`}>
                <div className="mobileMessageMeta">
                  <strong>{t("chat.participants.user")}</strong>
                  <time>
                    {localReply.status === "sending"
                      ? t("chat.actions.sending")
                      : localReply.status === "failed"
                        ? t("chat.actions.notSent")
                        : t("chat.actions.sent")}
                  </time>
                </div>
                <p>{localReply.content}</p>
              </div>
            </article>
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
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
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
          <p className="mobileComposerStatus" role="status">{t("chat.states.sendingReply")}</p>
        )}
        {sendMessage.isError && (
          <div className="mobileComposerStatus mobileComposerError" role="status">
            <span>{t("chat.states.replyStayed")}</span>
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
          </div>
        )}
      </form>
    </div>
  );
}
