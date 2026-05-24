import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, ShieldCheck, ShieldX, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { PermissionRequestItem } from '@/hooks/useChatMessages';
import styles from './PermissionDialog.module.css';

interface Props {
  requests: PermissionRequestItem[];
  onDecide: (requestId: string, decision: 'allow' | 'deny', reason?: string) => void;
}

const TIMEOUT_MS = 60_000;

function summarizeInput(input: Record<string, unknown>): string {
  if (typeof input.file_path === 'string') return `file: ${input.file_path}`;
  if (typeof input.path === 'string') return `path: ${input.path}`;
  if (typeof input.command === 'string') return input.command.slice(0, 100);
  if (typeof input.url === 'string') return `url: ${input.url}`;
  if (typeof input.pattern === 'string') return `pattern: ${input.pattern}`;
  const keys = Object.keys(input);
  if (keys.length === 0) return '(no arguments)';
  return keys.join(', ');
}

function formatInput(input: Record<string, unknown>): string {
  return JSON.stringify(input, null, 2);
}

export default function PermissionDialog({ requests, onDecide }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Show the latest unresolved request that hasn't been dismissed
  const visible = requests.filter((r) => !dismissedIds.has(r.requestId));
  const pendingCount = visible.filter((r) => !r.decision).length;
  const latestPending = visible.find((r) => !r.decision);
  const latestDecided = visible.filter((r) => r.decision).slice(-3);

  // Auto-expand when a new pending request arrives
  useEffect(() => {
    if (latestPending) {
      setExpanded(true);
    }
  }, [latestPending?.requestId]);

  const dismiss = useCallback((requestId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(requestId);
      return next;
    });
  }, []);

  const dismissAll = useCallback(() => {
    setDismissedIds(new Set(requests.map((r) => r.requestId)));
  }, [requests]);

  if (visible.length === 0) return null;

  return (
    <div className={styles.root} role="region" aria-label={t('perm.title')}>
      {/* Compact notification bar */}
      {!expanded && (
        <button
          className={styles.notificationBar}
          onClick={() => setExpanded(true)}
          aria-expanded={false}
        >
          <span className={styles.barIcon}>
            {pendingCount > 0 ? (
              <Shield size={16} className={styles.iconPending} />
            ) : (
              <ShieldCheck size={16} className={styles.iconAllowed} />
            )}
          </span>
          <span className={styles.barText}>
            {pendingCount > 0
              ? t('perm.pending', { count: pendingCount })
              : t('perm.lastDecided')}
          </span>
          {latestDecided.length > 0 && (
            <span className={styles.barLast}>
              {latestDecided[latestDecided.length - 1].toolName}:{' '}
              {latestDecided[latestDecided.length - 1].decision === 'allow' ? 'ALLOW' : 'DENY'}
            </span>
          )}
          <ChevronUp size={14} className={styles.barChevron} />
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              {pendingCount > 0 ? (
                <>
                  <Shield size={16} className={styles.iconPending} />
                  {t('perm.pending', { count: pendingCount })}
                </>
              ) : (
                <>
                  <ShieldCheck size={16} className={styles.iconAllowed} />
                  {t('perm.history')}
                </>
              )}
            </span>
            <span className={styles.panelActions}>
              <button
                className={styles.panelBtn}
                onClick={dismissAll}
                title={t('perm.dismissAll')}
              >
                <X size={14} />
              </button>
              <button
                className={styles.panelBtn}
                onClick={() => setExpanded(false)}
                title={t('perm.collapse')}
              >
                <ChevronDown size={14} />
              </button>
            </span>
          </div>

          <div className={styles.requestList}>
            {visible.slice(-10).reverse().map((req) => (
              <PermissionItem
                key={req.requestId}
                request={req}
                onDismiss={dismiss}
                onDecide={onDecide}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionItem({
  request,
  onDismiss,
  onDecide,
}: {
  request: PermissionRequestItem;
  onDismiss: (id: string) => void;
  onDecide: (requestId: string, decision: 'allow' | 'deny', reason?: string) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const { t } = useTranslation();
  const allowRef = useRef<HTMLButtonElement>(null);

  const isPending = !request.decision;
  const isAllowed = request.decision === 'allow';

  // Auto-focus Allow button for the first pending item
  useEffect(() => {
    if (isPending) {
      allowRef.current?.focus();
    }
  }, [isPending, request.requestId]);

  // 60s auto-deny timeout for pending requests
  useEffect(() => {
    if (!isPending) return;
    const timer = setTimeout(() => {
      onDecide(request.requestId, 'deny', 'timeout');
    }, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isPending, request.requestId, onDecide]);

  const handleAllow = useCallback(() => {
    onDecide(request.requestId, 'allow');
  }, [onDecide, request.requestId]);

  const handleDeny = useCallback(() => {
    onDecide(request.requestId, 'deny', 'user denied');
  }, [onDecide, request.requestId]);

  return (
    <div
      className={`${styles.item} ${isPending ? styles.itemPending : isAllowed ? styles.itemAllowed : styles.itemDenied}`}
    >
      <div className={styles.itemHeader}>
        <span className={styles.itemIcon}>
          {isPending ? (
            <Shield size={14} className={styles.iconPending} />
          ) : isAllowed ? (
            <ShieldCheck size={14} className={styles.iconAllowed} />
          ) : (
            <ShieldX size={14} className={styles.iconDenied} />
          )}
        </span>
        <code className={styles.itemTool}>{request.toolName}</code>
        <span className={styles.itemSummary}>{summarizeInput(request.toolInput)}</span>
        <span className={styles.itemStatus}>
          {isPending ? t('perm.awaiting') : isAllowed ? t('perm.allowed') : t('perm.denied')}
        </span>
        <button
          className={styles.itemDismiss}
          onClick={() => onDismiss(request.requestId)}
          title={t('perm.dismiss')}
        >
          <X size={12} />
        </button>
      </div>

      {/* Interactive allow/deny buttons for pending items */}
      {isPending && (
        <div className={styles.itemActions}>
          <button
            ref={allowRef}
            className={styles.allowBtn}
            onClick={handleAllow}
            aria-label={`Allow ${request.toolName} execution`}
          >
            {t('perm.allow')}
          </button>
          <button
            className={styles.denyBtn}
            onClick={handleDeny}
            aria-label={`Deny ${request.toolName} execution`}
          >
            {t('perm.deny')}
          </button>
        </div>
      )}

      {(showInput || isPending) && (
        <pre className={styles.itemInput}>{formatInput(request.toolInput)}</pre>
      )}

      {!isPending && (
        <button
          className={styles.showInputBtn}
          onClick={() => setShowInput((v) => !v)}
        >
          {showInput ? t('perm.hideInput') : t('perm.showInput')}
        </button>
      )}

      {request.reason && (
        <div className={styles.itemReason}>{request.reason}</div>
      )}
    </div>
  );
}
