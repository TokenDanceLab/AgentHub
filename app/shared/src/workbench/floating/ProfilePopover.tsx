import React, { useEffect, useRef, useCallback } from 'react';
import { DesignNavIcon, profileActionIconName } from '../designIcons';
import styles from './ProfilePopover.module.css';

type ProfileVariant = 'default' | 'agent' | 'group' | 'account';

interface ProfileAction {
  label: string;
  onClick?: () => void;
}

interface ProfileMetaRow {
  label: string;
  value: string;
}

interface AccountMenuRow {
  label: string;
  style?: 'normal' | 'danger';
  trail?: 'external' | null;
  divider?: boolean;
  onClick?: () => void;
}

interface AccountSpace {
  name: string;
  description: string;
}

interface ProfilePopoverProps {
  name: string;
  subtitle?: string;
  avatar?: string;
  avatarColor?: string;
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  variant?: ProfileVariant;
  badge?: string;
  actions?: ProfileAction[];
  meta?: ProfileMetaRow[];
  /* ── Account variant ── */
  org?: string;
  status?: string;
  signature?: string;
  accountMenu?: AccountMenuRow[];
  spaces?: AccountSpace[];
  onAction?: (action: string) => void;
  onAccountMenu?: (action: string) => void;
  onStatusToggle?: () => void;
  onSignatureEdit?: () => void;
}

export function ProfilePopover({
  name,
  subtitle,
  avatar,
  avatarColor,
  isOpen,
  onClose,
  anchorRef,
  variant = 'default',
  badge,
  actions,
  meta,
  org,
  status,
  signature,
  accountMenu,
  spaces,
  onAction,
  onAccountMenu,
  onStatusToggle,
  onSignatureEdit,
}: ProfilePopoverProps) {
  const popoverRef = useRef<HTMLElement>(null);

  const position = useCallback(() => {
    const popover = popoverRef.current;
    const anchor = anchorRef?.current;
    if (!popover || !anchor) return;

    const gap = 10;
    const rect = anchor.getBoundingClientRect();
    const popWidth = variant === 'account' ? 404 : 352;
    popover.style.width = `${popWidth}px`;

    const measuredHeight = Math.min(
      popover.getBoundingClientRect().height || 360,
      window.innerHeight - 28,
    );

    let left = rect.right + gap;
    if (left + popWidth > window.innerWidth - 12) {
      left = rect.left - popWidth - gap;
    }
    left = Math.max(12, Math.min(left, window.innerWidth - popWidth - 12));

    let top = rect.top - 10;
    if (top + measuredHeight > window.innerHeight - 12) {
      top = window.innerHeight - measuredHeight - 12;
    }
    top = Math.max(12, top);

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }, [anchorRef, variant]);

  /* ── Position on open ── */
  useEffect(() => {
    if (!isOpen) return;
    position();
  }, [isOpen, position]);

  /* ── Close on Escape ── */
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  /* ── Close on outside click ── */
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onClose();
      }
    }
    // Delay registration so the opening click doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const variantClass =
    variant === 'agent' ? styles.agent
    : variant === 'group' ? styles.group
    : variant === 'account' ? styles.account
    : '';

  const initials = avatar || name.slice(0, 1).toUpperCase();
  const avatarBg = avatarColor || 'var(--primary)';

  /* ── Account variant ── */
  if (variant === 'account') {
    return (
      <section
        ref={popoverRef}
        className={`${styles.popover} ${variantClass} ${isOpen ? styles.open : ''}`}
        role="dialog"
        aria-label={`${name} 账号菜单`}
        tabIndex={-1}
      >
        {/* Account head */}
        <div className={styles.accountHead}>
          <div
            className={`${styles.avatar} ${styles.accountAvatar}`}
            style={{ background: avatarBg }}
          >
            {initials}
          </div>
          <div className={styles.identity}>
            <div className={styles.titleRow}>
              <h3>{name}</h3>
              {badge && <span className={styles.badge}>{badge}</span>}
            </div>
            <p>
              {org}
              {org && status ? ' · ' : ''}
              {status}
            </p>
          </div>
          <button
            className={styles.accountStatus}
            type="button"
            onClick={onStatusToggle}
          >
            <DesignNavIcon name="check" size={13} />
            {status || '在线'}
          </button>
        </div>

        {/* Signature */}
        <button
          className={styles.accountSignature}
          type="button"
          onClick={onSignatureEdit}
        >
          {signature || '输入你的个性签名...'}
        </button>

        {/* Account actions */}
        {actions && actions.length > 0 && (
          <div className={`${styles.actions} ${styles.accountActions}`}>
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
        )}

        {/* Account menu */}
        {accountMenu && accountMenu.length > 0 && (
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
        )}

        {/* Spaces */}
        {spaces && spaces.length > 0 && (
          <div className={styles.accountSpaces} aria-label="账号空间">
            {spaces.map((space) => (
              <div key={space.name} className={styles.accountSpaceRow}>
                <strong>{space.name}</strong>
                <span>{space.description}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  /* ── Default / Agent / Group variant ── */
  return (
    <section
      ref={popoverRef}
      className={`${styles.popover} ${variantClass} ${isOpen ? styles.open : ''}`}
      role="dialog"
      aria-label={`${name} 资料卡`}
      tabIndex={-1}
    >
      {/* Head */}
      <div className={styles.head}>
        <div className={styles.avatar} style={{ background: avatarBg }}>
          {initials}
        </div>
        <div className={styles.identity}>
          <div className={styles.titleRow}>
            <h3>{name}</h3>
            {badge && <span className={styles.badge}>{badge}</span>}
          </div>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className={styles.actions}>
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
      )}

      {/* Meta */}
      {meta && meta.length > 0 && (
        <div className={styles.meta}>
          {meta.map((row) => (
            <div key={row.label} className={styles.metaRow}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
