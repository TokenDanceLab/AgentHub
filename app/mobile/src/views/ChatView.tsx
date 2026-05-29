import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Copy, RefreshCw, SendHorizonal } from "lucide-react";
import type { Thread, ThreadItem } from "@agenthub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createThreadMessage, listThreadItems } from "@agenthub/shared";
import { useTranslation } from "react-i18next";

interface ChatViewProps {
  thread: Thread;
  onBack: () => void;
}

export function ChatView({ thread, onBack }: ChatViewProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const messages = useQuery({
    queryKey: ["thread-items", thread.id],
    queryFn: () => listThreadItems(thread.id, { pageSize: 100 }),
  });

  const sendMessage = useMutation({
    mutationFn: (content: string) => createThreadMessage(thread.id, { role: "user", content }),
    onSuccess: () => {
      setInputValue("");
      void queryClient.invalidateQueries({ queryKey: ["thread-items", thread.id] });
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || sendMessage.isPending) return;
    sendMessage.mutate(content);
  }, [inputValue, sendMessage]);

  const visibleItems = useMemo(
    () => (messages.data?.items ?? []).filter((item) => item.kind === "message" && item.content.trim()),
    [messages.data?.items],
  );

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

      <div className="mobileScroll mobileChatScroll">
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
              <dd>{visibleItems.length}</dd>
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
          <div className="mobileCenterState">
            <strong>{t("chat.states.syncErrorTitle")}</strong>
            <p>{t("chat.states.syncErrorDescription")}</p>
            <button className="mobileActionButton" type="button" onClick={() => messages.refetch()}>
              <RefreshCw size={16} />
              <span>{t("chat.actions.retry")}</span>
            </button>
          </div>
        )}

        {!messages.isLoading && !messages.isError && visibleItems.length === 0 && (
          <div className="mobileCenterState">
            <strong>{t("chat.states.emptyTitle")}</strong>
            <p>{t("chat.states.emptyDescription")}</p>
          </div>
        )}

        <div className="mobileMessageList">
          {visibleItems.map(renderItem)}
          {sendMessage.isPending && (
            <article className="mobileMessageRow mobileMessageRowUser">
              <div className="mobileMessage mobileUserMsg mobilePendingMsg">
                <div className="mobileMessageMeta">
                  <strong>{t("chat.participants.user")}</strong>
                  <time>{t("chat.actions.sending")}</time>
                </div>
                <p>{inputValue.trim()}</p>
              </div>
            </article>
          )}
        </div>
      </div>

      <form
        className="mobileComposerDock"
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
      >
        <textarea
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={t("chat.composer.placeholder")}
          rows={2}
          disabled={sendMessage.isPending}
        />
        <button className="mobileSendButton" type="submit" disabled={!inputValue.trim() || sendMessage.isPending}>
          {sendMessage.isPending ? <RefreshCw size={17} className="mobileSpin" /> : <SendHorizonal size={17} />}
          <span>{sendMessage.isPending ? t("chat.actions.sending") : t("chat.actions.send")}</span>
        </button>
        {sendMessage.isError && (
          <p className="mobileComposerError">{t("chat.states.composerError")}</p>
        )}
      </form>
    </div>
  );
}
