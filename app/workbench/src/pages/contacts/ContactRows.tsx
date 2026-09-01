import React, { useCallback } from 'react';
import { appDateLocaleTag } from '@shared/i18n/locale';
import { getI18n, useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
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
        aria-label={t('contacts.viewProfileAria', { name: member.name })}
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
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
          {direction === 'received' ? t('contacts.requestReceived') : t('contacts.requestSent')} {timeLabel && `· ${timeLabel}`}
        </span>
      </div>
      {direction === 'received' && (
        <div className={styles.requestActions}>
          <button type="button" className={styles.acceptBtn} disabled={loading} onClick={() => onAccept?.(request.request_id)}>{t('contacts.accept')}</button>
          <button type="button" className={styles.rejectBtn} disabled={loading} onClick={() => onReject?.(request.request_id)}>{t('contacts.reject')}</button>
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const initials = (result.nickname || result.username).slice(0, 2).toUpperCase();
  const displayName = result.nickname || result.username;
  const relationshipLabel = (): string => {
    switch (result.relationship) {
      case 'friend': return t('contacts.relationship.friend');
      case 'pending_sent': return t('contacts.relationship.pendingSent');
      case 'pending_received': return t('contacts.relationship.pendingReceived');
      case 'blocked': return t('contacts.relationship.blocked');
      default: return t('contacts.relationship.stranger');
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
        <button type="button" className={styles.acceptBtn} disabled={loading} onClick={() => onSendRequest?.(result.user_id)}>{t('contacts.addFriend')}</button>
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
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
        aria-label={t('contacts.viewProfileAria', { name: group.name })}
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
      <span className={styles.memberStatus}>{t('contacts.openGroupChat')}</span>
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
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
        aria-label={t('contacts.viewProfileAria', { name: desk.name })}
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
      <em className={styles.serviceCardAction}>{t('contacts.enter')}</em>
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const first =
    variant === 'invite'
      ? { label: t('contacts.quick.inviteTitle'), desc: t('contacts.quick.inviteDesc') }
      : { label: t('contacts.quick.memberTitle'), desc: t('contacts.quick.memberDesc') };
  const second =
    variant === 'invite'
      ? { label: t('contacts.quick.addExternalTitle'), desc: t('contacts.quick.addExternalDesc') }
      : { label: t('contacts.quick.externalTitle'), desc: t('contacts.quick.externalDesc') };

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
