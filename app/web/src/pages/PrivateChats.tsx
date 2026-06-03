import { useTranslation } from 'react-i18next';
import { MessageSquare, Search, Star, Paperclip, Code, User } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { useHubIMSnapshot } from '@/hooks/useHubIMSnapshot';
import { useHubSession } from '@/hooks/useHubSession';
import { EmptyState, SectionHeader, ActivityCard } from '@shared/ui';
import { useState, useMemo } from 'react';
import type { TFunction } from 'i18next';

function formatRelativeTime(isoString: string | undefined, t: TFunction): string {
  if (!isoString) return '';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('time.justNow');
  if (mins < 60) return t('time.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  return t('time.yesterday');
}

function PrivateChatsPage() {
  const { t } = useTranslation('privateChats');
  const { hasSession, token } = useHubSession();
  const [searchQuery, setSearchQuery] = useState('');

  const snapshot = useHubIMSnapshot(token);

  const chats = useMemo(() => {
    if (!hasSession || snapshot.status !== 'ready') return [];
    return snapshot.sessions
      .filter((s) => s.type === 'private')
      .map((s) => ({
        id: s.session_id ?? s.id ?? '',
        name: s.name ?? t('hub.privateSessionFallback'),
        lastMessage: s.last_message?.content ?? t('hub.noRecentMessages'),
        time: formatRelativeTime(s.last_message_at, t),
        unread: s.unread_count ?? 0,
        online: true,
      }));
  }, [hasSession, snapshot, t]);

  const filteredChats = searchQuery
    ? chats.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()))
    : chats;

  const isLoading = hasSession && snapshot.status === 'loading';

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <SectionHeader
        title={t('sidebar.title')}
        eyebrow={t('brand.subtitle')}
      />

      <div style={{ marginTop: 12, marginBottom: 16 }}>
        <ActivityCard
          label={hasSession ? t('chat.localPreview') : t('status.locked')}
          icon={<MessageSquare size={16} />}
        >
          {isLoading ? t('loading.description') : hasSession ? t('chat.readOnly') : t('locked.description')}
        </ActivityCard>
      </div>

      {hasSession ? (
        <>
          <div style={{ marginBottom: 12, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--muted)' }} />
            <input
              type="text"
              placeholder={t('search.placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t('search.ariaLabel')}
              style={{
                width: '100%',
                padding: '10px 10px 10px 32px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 14,
                background: 'var(--surface)',
                color: 'var(--text)',
              }}
            />
          </div>

          {filteredChats.length === 0 ? (
            <EmptyState
              title={t('sidebar.emptyTitle')}
              description={t('sidebar.empty')}
              icon={<MessageSquare size={24} />}
              titleLevel={3}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    gap: 12,
                    background: chat.unread > 0 ? 'var(--surface-highlight)' : 'var(--surface)',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'var(--primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 600, fontSize: 16,
                    flexShrink: 0,
                  }}>
                    {chat.name[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{chat.name}</span>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: chat.online ? 'var(--success)' : 'var(--muted)',
                        flexShrink: 0,
                      }} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {chat.lastMessage}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{chat.time}</span>
                    {chat.unread > 0 && (
                      <span style={{
                        background: 'var(--primary)',
                        color: '#fff', fontSize: 11, fontWeight: 600,
                        padding: '1px 6px', borderRadius: 10,
                      }}>
                        {chat.unread}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <ActivityCard label={t('header.star')} icon={<Star size={14} />}>0</ActivityCard>
            <ActivityCard label={t('header.attachments')} icon={<Paperclip size={14} />}>0</ActivityCard>
            <ActivityCard label={t('code.snippet')} icon={<Code size={14} />}>0</ActivityCard>
          </div>
        </>
      ) : (
        <EmptyState
          title={t('locked.title')}
          description={t('locked.description')}
          icon={<User size={24} />}
          titleLevel={3}
        />
      )}
    </div>
  );
}

export default function PrivateChatsPageInteractive() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PrivateChatsPage />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
