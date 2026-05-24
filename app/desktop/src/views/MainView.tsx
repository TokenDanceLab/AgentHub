import { useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewMode } from '@/config/viewRegistry';
import type { ChatMessage } from '@/components/ChatView.types';
import ErrorBoundary from '@/components/ErrorBoundary';
import WelcomeScreen from '@/components/WelcomeScreen';
import { SkeletonLine } from '@/components/Skeleton';
import styles from '@/App.module.css';

const ChatView = lazy(() => import('@/components/ChatView'));

interface Props {
  messages: ChatMessage[];
  allMessages: ChatMessage[];
  threadsCount: number;
  isStreaming: boolean;
  isConnected: boolean;
  onRetry: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onSendMessage: (message: string) => void;
}

/** Determine which view mode to display based on app state. */
export function resolveViewMode(
  allMessages: ChatMessage[],
  messages: ChatMessage[],
  threadsCount: number,
  isStreaming: boolean,
  isConnected: boolean,
): ViewMode {
  if (allMessages.length === 0 && threadsCount === 0 && isConnected) return 'welcome';
  if (messages.length === 0 && isStreaming) return 'loading';
  return 'chat';
}

export default function MainView({
  messages,
  allMessages,
  threadsCount,
  isStreaming,
  isConnected,
  onRetry,
  onDelete,
  onSendMessage,
}: Props) {
  const { t } = useTranslation();

  const viewMode = resolveViewMode(allMessages, messages, threadsCount, isStreaming, isConnected);

  const handleCreateThread = useCallback(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder*="Type a message"]',
    );
    if (textarea) {
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => textarea.focus(), 150);
    }
  }, []);

  if (viewMode === 'welcome') {
    return (
      <WelcomeScreen
        online={isConnected}
        onCreateThread={handleCreateThread}
        onSendMessage={onSendMessage}
      />
    );
  }

  if (viewMode === 'loading') {
    return (
      <div className={styles.skeletonChat} aria-busy="true" aria-label="Generating response">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={i % 2 === 0 ? styles.skeletonChatBubble : styles.skeletonChatBubbleRight}>
            <SkeletonLine width={`${90 - i * 15}%`} height="14px" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className={styles.skeletonChat} aria-busy="true" aria-label="Loading chat">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={i % 2 === 0 ? styles.skeletonChatBubble : styles.skeletonChatBubbleRight}>
                <SkeletonLine width={`${90 - i * 10}%`} height="14px" />
              </div>
            ))}
          </div>
        }
      >
        <ChatView
          messages={allMessages}
          isStreaming={isStreaming}
          onRetry={onRetry}
          onDelete={onDelete}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
