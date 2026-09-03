import React from 'react';
import { DesignNavIcon, profileActionIconName } from '../designIcons';
import type {
  AccountMenuRow,
  ProfileAction,
  ProfileMetaRow,
} from './ProfilePopoverHelpers';
import {
  accountOrgStatusText,
  accountStatusLabel,
  profileAvatarBackground,
  profileInitials,
} from './ProfilePopoverHelpers';
import styles from './ProfilePopover.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   ProfilePopoverParts — presentational residual slices from
   ProfilePopover (#743).

   Account / default body sections and shared rows. CSS remains on
   ProfilePopover.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

function ProfileAvatarGlyph({
  avatar,
  avatarColor,
  avatarUrl,
  name,
  className,
  clearBackgroundWhenImage = false,
}: {
  avatar?: string | undefined;
  avatarColor?: string | undefined;
  avatarUrl?: string | undefined;
  name: string;
  className: string;
  clearBackgroundWhenImage?: boolean | undefined;
}): React.ReactElement {
  const initials = profileInitials(avatar, name);
  const background = profileAvatarBackground(avatarColor, {
    clearWhenImage: clearBackgroundWhenImage,
    avatarUrl,
  });
  const content = avatarUrl ? (
    <img
      alt=""
      src={avatarUrl}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
    />
  ) : initials;

  return (
    <div className={className} style={{ background }}>
      {content}
    </div>
  );
}

function ProfileTitleRow({
  name,
  badge,
}: {
  name: string;
  badge?: string | undefined;
}): React.ReactElement {
  return (
    <div className={styles.titleRow}>
      <h3>{name}</h3>
      {badge && <span className={styles.badge}>{badge}</span>}
    </div>
  );
}

function ProfileActionButtons({
  actions,
  onAction,
  className,
}: {
  actions: ProfileAction[];
  onAction?: ((action: string) => void) | undefined;
  className?: string | undefined;
}): React.ReactElement | null {
  if (actions.length === 0) return null;
  return (
    <div className={className ?? styles.actions}>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onAction?.(action.label)}
        >
          <DesignNavIcon name={profileActionIconName(action.label)} size={15} />
          {action.label}
        </button>
      ))}
    </div>
  );
}

function ProfileMetaRows({
  meta,
}: {
  meta: ProfileMetaRow[];
}): React.ReactElement | null {
  if (meta.length === 0) return null;
  return (
    <div className={styles.meta}>
      {meta.map((row) => (
        <div key={row.label} className={styles.metaRow}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function AccountMenuRows({
  accountMenu,
  onAccountMenu,
}: {
  accountMenu: AccountMenuRow[];
  onAccountMenu?: ((action: string) => void) | undefined;
}): React.ReactElement | null {
  if (accountMenu.length === 0) return null;
  return (
    <div className={styles.accountMenu}>
      {accountMenu.map((row, i) => {
        if (row.divider) {
          return (
            <div
              key={`sep-${i}`}
              className={styles.menuSep}
              role="separator"
            />
          );
        }
        return (
          <button
            key={row.label}
            className={`${styles.accountMenuRow} ${row.style === 'danger' ? styles.danger : ''}`}
            type="button"
            onClick={() => onAccountMenu?.(row.label)}
          >
            <span className={styles.menuIcon}>
              <DesignNavIcon name={profileActionIconName(row.label)} size={16} />
            </span>
            <span>{row.label}</span>
            {row.trail === 'external' && (
              <span className={styles.menuTail}>
                <DesignNavIcon name="external" size={16} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AccountProfileBody({
  name,
  avatar,
  avatarColor,
  avatarUrl,
  badge,
  org,
  status,
  actions,
  accountMenu,
  onAction,
  onAccountMenu,
  onStatusToggle,
}: {
  name: string;
  avatar?: string | undefined;
  avatarColor?: string | undefined;
  avatarUrl?: string | undefined;
  badge?: string | undefined;
  org?: string | undefined;
  status?: string | undefined;
  actions?: ProfileAction[] | undefined;
  accountMenu?: AccountMenuRow[] | undefined;
  onAction?: ((action: string) => void) | undefined;
  onAccountMenu?: ((action: string) => void) | undefined;
  onStatusToggle?: (() => void) | undefined;
}): React.ReactElement {
  return (
    <>
      <div className={styles.accountHead}>
        <ProfileAvatarGlyph
          avatar={avatar}
          avatarColor={avatarColor}
          avatarUrl={avatarUrl}
          className={`${styles.avatar} ${styles.accountAvatar}`}
          clearBackgroundWhenImage
          name={name}
        />
        <div className={styles.identity}>
          <ProfileTitleRow badge={badge} name={name} />
          <p>{accountOrgStatusText(org, status)}</p>
        </div>
        {/* Without a real toggle handler the status renders as a passive
            chip — a clickable button with no effect would be a fake
            interaction (#1818). */}
        {onStatusToggle ? (
          <button
            className={styles.accountStatus}
            type="button"
            onClick={onStatusToggle}
          >
            <DesignNavIcon name="check" size={13} />
            {accountStatusLabel(status)}
          </button>
        ) : (
          <span className={styles.accountStatus}>
            <DesignNavIcon name="check" size={13} />
            {accountStatusLabel(status)}
          </span>
        )}
      </div>

      {actions && actions.length > 0 && (
        <ProfileActionButtons
          actions={actions}
          className={`${styles.actions} ${styles.accountActions}`}
          onAction={onAction}
        />
      )}

      {accountMenu && accountMenu.length > 0 && (
        <AccountMenuRows accountMenu={accountMenu} onAccountMenu={onAccountMenu} />
      )}
    </>
  );
}

export function DefaultProfileBody({
  name,
  subtitle,
  avatar,
  avatarColor,
  badge,
  actions,
  meta,
  onAction,
}: {
  name: string;
  subtitle?: string | undefined;
  avatar?: string | undefined;
  avatarColor?: string | undefined;
  badge?: string | undefined;
  actions?: ProfileAction[] | undefined;
  meta?: ProfileMetaRow[] | undefined;
  onAction?: ((action: string) => void) | undefined;
}): React.ReactElement {
  const initials = profileInitials(avatar, name);
  const avatarBg = profileAvatarBackground(avatarColor);

  return (
    <>
      <div className={styles.head}>
        <div className={styles.avatar} style={{ background: avatarBg }}>
          {initials}
        </div>
        <div className={styles.identity}>
          <ProfileTitleRow badge={badge} name={name} />
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>

      {actions && actions.length > 0 && (
        <ProfileActionButtons actions={actions} onAction={onAction} />
      )}

      {meta && meta.length > 0 && <ProfileMetaRows meta={meta} />}
    </>
  );
}
