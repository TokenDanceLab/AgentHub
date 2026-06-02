import { useTranslation } from 'react-i18next';
import { MessageSquare, Search, Star, Paperclip, Code, User } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { useHubSession } from '@/hooks/useHubSession';
import { EmptyState, SectionHeader, ActivityCard } from '@shared/ui';
import { useState } from 'react';

function PrivateChatsPage() {
  const { t } = useTranslation('privateChats');
  const { hasSession } = useHubSession();
  const [searchQuery, setSearchQuery] = useState('');

  const mockChats = hasSession
    ? [
        { id: '1', name: 'Alice', lastMessage: t('hub.noRecentMessages'), time: '10:30', unread: 2, online: true },
        { id: '2', name: 'Bob', lastMessage: 'Let me review that diff...', time: '09:15', unread: 0, online: false },
        { id: '3', name: 'AgentHub Bot', lastMessage: 'Run #42 completed successfully.', time: '昨天', unread: 1, online: true },
      ]
    : [];

  const filteredChats = searchQuery
    ? mockChats.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()))
    : mockChats;

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
          {hasSession ? t('chat.readOnly') : t('locked.description')}
        </ActivityCard>
      </div>

      {hasSession ? (
        <>
          <div style={{ marginBottom: 12, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-muted, #64748b)' }} />
            <input
              type="text"
              placeholder={t('search.placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t('search.ariaLabel')}
              style={{
                width: '100%',
                padding: '10px 10px 10px 32px',
                border: '1px solid var(--color-border, #e2e8f0)',
                borderRadius: 8,
                fontSize: 14,
                background: 'var(--color-surface, #fff)',
                color: 'var(--color-text, #1a1a2e)',
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
                    border: '1px solid var(--color-border, #e2e8f0)',
                    borderRadius: 8,
                    gap: 12,
                    background: chat.unread > 0 ? 'var(--color-surface-highlight, #f0f4ff)' : 'var(--color-surface, #fff)',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'var(--color-primary, #4f46e5)',
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
                        background: chat.online ? 'var(--color-success, #22c55e)' : 'var(--color-muted, #94a3b8)',
                        flexShrink: 0,
                      }} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted, #64748b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {chat.lastMessage}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)' }}>{chat.time}</span>
                    {chat.unread > 0 && (
                      <span style={{
                        background: 'var(--color-primary, #4f46e5)',
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
