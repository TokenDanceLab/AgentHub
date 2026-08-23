import React, { useCallback } from 'react';
import { appDateLocaleTag } from '@shared/i18n/locale';
import { getI18n } from 'react-i18next';
import styles from '../ContactsPage.module.css';
import { capabilityColor } from './shared';
import type {
  ContactGroup,
  ContactMember,
  FriendRequestRow,
  HubSearchResultRow,
  ServiceDesk,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Contact list rows / cards — extracted for Phase 17 strangler slice #561.
   CSS remains on shared ContactsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export function MemberRow({
  member,
  isGroup = false,
  onClick,
  onAvatarClick,
  avatarExpanded = false,
}: {
  member: ContactMember;
  isGroup?: boolean;
  onClick?: ((member: ContactMember) => void) | undefined;
  onAvatarClick?: ((member: ContactMember, anchor: HTMLElement) => void) | undefined;
  avatarExpanded?: boolean;
}) {
  const handleClick = useCallback(() => {
    onClick?.(member);
  }, [member, onClick]);

  const handleAvatarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(member, event.currentTarget);
  }, [member, onAvatarClick]);

  const handleAvatarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(member, event.currentTarget);
  }, [member, onAvatarClick]);

  return (
    <button
      type="button"
      className={`${styles.memberRow} member-row`}
      data-card-surface
      onClick={handleClick}
    >
      <div
        aria-expanded={avatarExpanded}
        aria-haspopup="dialog"
        aria-label={`查看 ${member.name} 资料`}
        className={styles.memberAv}
        data-profile={member.id}
        onClick={handleAvatarClick}
        onKeyDown={handleAvatarKeyDown}
        role="button"
        tabIndex={0}
      >
        {member.initials}
      </div>
      <span className={styles.memberName}>{member.name}</span>
      {member.capabilities && member.capabilities.length > 0 && (
        <span className={styles.capabilityTags}>
          {member.capabilities.slice(0, 3).map((cap, i) => {
            const color = capabilityColor(i);
            return (
              <span
                key={cap}
                className={`${styles.capabilityTag} ${color ? styles[color as keyof typeof styles] : ''}`}
              >
                {cap}
              </span>
            );
          })}
        </span>
      )}
      {member.tag && <span className={styles.memberTag}>{member.tag}</span>}
      <span
        className={`${styles.memberOrg} ${isGroup ? styles.groupMemberOrg : ''}`}
      >
        {member.org}
      </span>
      <span className={styles.memberStatus}>{member.status}</span>
    </button>
  );
}

// ── Friend request card ──

export function FriendRequestCard({ request, direction, onAccept, onReject, loading }: {
  request: FriendRequestRow;
  direction: 'received' | 'sent';
  onAccept?: ((requestId: string) => void) | undefined;
  onReject?: ((requestId: string) => void) | undefined;
  loading?: boolean;
}): React.ReactElement {
  const initials = (request.nickname || request.username).slice(0, 2).toUpperCase();
  const displayName = request.nickname || request.username;
  const timeLabel = request.created_at
    ? new Date(request.created_at).toLocaleDateString(appDateLocaleTag(getI18n()?.language), { month: 'short', day: 'numeric' })
    : '';
  return (
    <div className={styles.requestCard} data-card-surface>
      <div className={styles.requestAvatar}>{initials}</div>
      <div className={styles.requestInfo}>
        <span className={styles.requestName}>{displayName}</span>
        {request.message && <span className={styles.requestMsg}>{request.message}</span>}
        <span className={styles.requestMeta}>
          {direction === 'received' ? '收到请求' : '已发送'} {timeLabel && `· ${timeLabel}`}
        </span>
      </div>
      {direction === 'received' && (
        <div className={styles.requestActions}>
          <button type="button" className={styles.acceptBtn} disabled={loading} onClick={() => onAccept?.(request.request_id)}>接受</button>
          <button type="button" className={styles.rejectBtn} disabled={loading} onClick={() => onReject?.(request.request_id)}>拒绝</button>
        </div>
      )}
    </div>
  );
}

// ── Search result card ──

export function SearchUserCard({ result, onSendRequest, loading }: {
  result: HubSearchResultRow;
  onSendRequest?: ((userId: string) => void) | undefined;
  loading?: boolean;
}): React.ReactElement {
  const initials = (result.nickname || result.username).slice(0, 2).toUpperCase();
  const displayName = result.nickname || result.username;
  const relationshipLabel = (): string => {
    switch (result.relationship) {
      case 'friend': return '已是好友';
      case 'pending_sent': return '已发送请求';
      case 'pending_received': return '收到对方请求';
      case 'blocked': return '已屏蔽';
      default: return '陌生人';
    }
  };
  return (
    <div className={styles.searchResultCard} data-card-surface>
      <div className={styles.requestAvatar}>{initials}</div>
      <div className={styles.requestInfo}>
        <span className={styles.requestName}>{displayName}</span>
        <span className={styles.requestMeta}>@{result.username} · {relationshipLabel()}</span>
      </div>
      {result.relationship === 'stranger' && (
        <button type="button" className={styles.acceptBtn} disabled={loading} onClick={() => onSendRequest?.(result.user_id)}>添加好友</button>
      )}
    </div>
  );
}

export function GroupRow({
  group,
  onClick,
  onAvatarClick,
  avatarExpanded = false,
}: {
  group: ContactGroup;
  onClick?: ((group: ContactGroup) => void) | undefined;
  onAvatarClick?: ((group: ContactGroup, anchor: HTMLElement) => void) | undefined;
  avatarExpanded?: boolean;
}) {
  const handleClick = useCallback(() => {
    onClick?.(group);
  }, [group, onClick]);

  const handleAvatarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(group, event.currentTarget);
  }, [group, onAvatarClick]);

  const handleAvatarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(group, event.currentTarget);
  }, [group, onAvatarClick]);

  return (
    <button type="button" className={`${styles.memberRow} member-row`} data-card-surface onClick={handleClick}>
      <div
        aria-expanded={avatarExpanded}
        aria-haspopup="dialog"
        aria-label={`查看 ${group.name} 资料`}
        className={styles.memberAv}
        data-profile={group.id}
        onClick={handleAvatarClick}
        onKeyDown={handleAvatarKeyDown}
        role="button"
        tabIndex={0}
      >
        {group.initials}
      </div>
      <span className={styles.memberName}>{group.name}</span>
      <span className={styles.memberTag}>{group.count}</span>
      <span className={`${styles.memberOrg} ${styles.groupMemberOrg}`}>
        {group.latestMessage}
      </span>
      <span className={styles.memberStatus}>打开群聊</span>
    </button>
  );
}

export function ServiceCardRow({
  desk,
  onClick,
  onAvatarClick,
  avatarExpanded = false,
}: {
  desk: ServiceDesk;
  onClick?: ((desk: ServiceDesk) => void) | undefined;
  onAvatarClick?: ((desk: ServiceDesk, anchor: HTMLElement) => void) | undefined;
  avatarExpanded?: boolean;
}) {
  const handleClick = useCallback(() => {
    onClick?.(desk);
  }, [desk, onClick]);

  const handleAvatarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(desk, event.currentTarget);
  }, [desk, onAvatarClick]);

  const handleAvatarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(desk, event.currentTarget);
  }, [desk, onAvatarClick]);

  return (
    <button type="button" className={`${styles.serviceCard} service-card`} data-card-surface onClick={handleClick}>
      <div
        aria-expanded={avatarExpanded}
        aria-haspopup="dialog"
        aria-label={`查看 ${desk.name} 资料`}
        className={styles.memberAv}
        data-profile={desk.id}
        onClick={handleAvatarClick}
        onKeyDown={handleAvatarKeyDown}
        role="button"
        tabIndex={0}
      >
        {desk.initials}
      </div>
      <div>
        <strong className={styles.serviceCardName}>{desk.name}</strong>
        <span className={styles.serviceCardDesc}>{desk.description}</span>
      </div>
      <em className={styles.serviceCardAction}>进入</em>
    </button>
  );
}

export function QuickActionGrid({
  onAddContact,
  variant = 'directory',
}: {
  onAddContact?: (() => void) | undefined;
  variant?: 'directory' | 'invite';
}) {
  const first =
    variant === 'invite'
      ? { label: '邀请企业成员', desc: '生成二维码、链接、邀请码或手机号邀请。' }
      : { label: '企业成员', desc: '通过二维码、链接或手机号邀请同事加入 TokenDance' };
  const second =
    variant === 'invite'
      ? { label: '添加外部联系人', desc: '适合客户、合作方和临时项目协作者。' }
      : { label: '外部联系人', desc: '添加客户、合作方或临时协作者到通讯录' };

  return (
    <div className={styles.quickGrid}>
      <button type="button" className={styles.quickBtn} onClick={onAddContact}>
        <span className={styles.quickBtnLabel}>{first.label}</span>
        <strong className={styles.quickBtnDesc}>
          {first.desc}
        </strong>
      </button>
      <button type="button" className={styles.quickBtn} onClick={onAddContact}>
        <span className={styles.quickBtnLabel}>{second.label}</span>
        <strong className={styles.quickBtnDesc}>
          {second.desc}
        </strong>
      </button>
    </div>
  );
}
