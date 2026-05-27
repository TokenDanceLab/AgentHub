import { useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { ChatInput, ChatBubble } from "@agenthub/shared/components";
import type { Thread, Message, ThreadItem, ListResponse } from "@agenthub/shared";
import { useQuery } from "@tanstack/react-query";
import { listThreadItems } from "@agenthub/shared";

interface ChatViewProps {
  thread: Thread;
  onBack: () => void;
}

export function ChatView({ thread, onBack }: ChatViewProps) {
  const [inputValue, setInputValue] = useState("");

  const messages = useQuery({
    queryKey: ["thread-items", thread.id],
    queryFn: () => listThreadItems(thread.id, { pageSize: 100 }),
  });

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return;
    // TODO: call createThreadMessage via Hub API
    setInputValue("");
    messages.refetch();
  }, [inputValue, messages]);

  function renderItem(item: ThreadItem) {
    if (item.kind !== "message") return null;
    const content = item.content ?? "";
    const sender = {
      name: item.role === "agent" ? "Agent" : "You",
    };

    return (
      <ChatBubble
        key={item.id}
        sender={sender}
        content={content}
        timestamp={new Date(item.createdAt).toLocaleTimeString()}
        isAgent={item.role === "agent"}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header
        className="glass shrink-0 flex items-center gap-3 px-3"
        style={{
          height: "calc(56px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <button
          onClick={onBack}
          className="flex items-center justify-center rounded-lg"
          style={{ width: 40, height: 40, color: "var(--td-ink-70)" }}
          aria-label="Back to threads"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold truncate" style={{ color: "var(--td-ink)" }}>
            {thread.title || thread.id}
          </h2>
        </div>
      </header>

      <div className="flex-1 scroll-container px-3 py-2">
        {messages.data?.items.map(renderItem)}
      </div>

      <div
        className="shrink-0 px-3 py-2"
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
