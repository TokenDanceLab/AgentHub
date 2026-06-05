import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  ShieldCheck,
  ShieldX,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Zap,
  Globe,
  FileText,
  CheckSquare,
  Square,
} from 'lucide-react';
import type { PermissionRequestItem } from '@/hooks/useChatMessages';
import styles from './PermissionDialog.module.css';

// @agenthub/approval-modes: mirrors edge-server ApprovalMode
export type ApprovalMode = 'yolo' | 'auto' | 'manual';

interface Props {
  requests: PermissionRequestItem[];
  onDecide: (requestId: string, decision: 'allow' | 'deny', reason?: string) => void;
  /** Current approval mode — displayed in the mode selector. Defaults to 'auto'. */
  approvalMode?: ApprovalMode;
  /** Called when the user changes the approval mode via the selector. */
  onApprovalModeChange?: (mode: ApprovalMode) => void;
}

const TIMEOUT_MS = 60_000;

const MODE_LABELS: Record<ApprovalMode, string> = {
  yolo: 'YOLO',
  auto: 'Auto',
  manual: 'Manual',
};

const MODE_ORDER: ApprovalMode[] = ['yolo', 'auto', 'manual'];

function summarizeInput(input: Record<string, unknown> | null | undefined): string {
  if (!input) return '(no input)';
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

// ── Risk level display helpers ──

function riskColor(risk: string | undefined): string {
  switch (risk) {
    case 'low':
      return styles.riskLow ?? '';
    case 'medium':
      return styles.riskMedium ?? '';
    case 'high':
      return styles.riskHigh ?? '';
    case 'critical':
    case 'blocked':
      return styles.riskCritical ?? '';
    default:
      return styles.riskDefault ?? '';
  }
}

function riskLabel(risk: string | undefined): string {
  switch (risk) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Med';
    case 'high':
      return 'High';
    case 'critical':
    case 'blocked':
      return 'Crit';
    default:
      return risk ? risk.slice(0, 4) : '?';
  }
}

function RiskBadge({ risk }: { risk: string | undefined }) {
  if (!risk) return null;
  const colorClass = riskColor(risk);
  const icon =
    risk === 'low' ? (
      <FileText size={10} />
    ) : risk === 'medium' ? (
      <Zap size={10} />
    ) : risk === 'high' ? (
      <Globe size={10} />
    ) : (
      <AlertTriangle size={10} />
    );
  return (
    <span className={`${styles.riskBadge} ${colorClass}`}>
      {icon}
      {riskLabel(risk)}
    </span>
  );
}

// ── Approval mode selector ──

function ModeSelector({
  mode,
  onChange,
}: {
  mode: ApprovalMode;
  onChange?: (mode: ApprovalMode) => void;
}) {
  const cycleMode = useCallback(() => {
    const idx = MODE_ORDER.indexOf(mode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length]!;
    onChange?.(next);
  }, [mode, onChange]);

  return (
    <span className={styles.modeSelector}>
      <button
        className={styles.modeBtn}
        onClick={cycleMode}
        title={
          onChange
            ? 'Click to cycle: YOLO → Auto → Manual'
            : `Current mode: ${MODE_LABELS[mode]}`
        }
        disabled={!onChange}
        aria-label={`Approval mode: ${MODE_LABELS[mode]}${onChange ? '. Click to change.' : ''}`}
      >
        {mode === 'yolo' ? (
          <Zap size={12} className={styles.modeIconYOLO} />
        ) : mode === 'auto' ? (
          <Shield size={12} className={styles.modeIconAuto} />
        ) : (
          <ShieldCheck size={12} className={styles.modeIconManual} />
        )}
        <span className={styles.modeLabel}>{MODE_LABELS[mode]}</span>
      </button>
    </span>
  );
}

// ── Main component ──

export default function PermissionDialog({
  requests,
  onDecide,
  approvalMode = 'auto',
  onApprovalModeChange,
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Show the latest unresolved request that hasn't been dismissed
  const visible = requests.filter((r) => !dismissedIds.has(r.requestId));
  const pendingCount = visible.filter((r) => !r.decision).length;
  const latestPending = visible.find((r) => !r.decision);
  const latestDecided = visible.filter((r) => r.decision).slice(-3);
  const lastDecided = latestDecided[latestDecided.length - 1];

  // Auto-expand when a new pending request arrives
  useEffect(() => {
    if (!latestPending) return;
    queueMicrotask(() => setExpanded(true));
  }, [latestPending]);

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
        <div className={styles.notificationBar}>
          <button
            className={styles.notificationBarBtn}
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            aria-label={t('perm.title')}
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
            {lastDecided && (
              <span className={styles.barLast}>
                {lastDecided.toolName}:{' '}
                {lastDecided.decision === 'allow' ? 'ALLOW' : 'DENY'}
              </span>
            )}
            <ChevronUp size={14} className={styles.barChevron} />
          </button>
          <ModeSelector mode={approvalMode} onChange={onApprovalModeChange} />
        </div>
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
              <ModeSelector mode={approvalMode} onChange={onApprovalModeChange} />
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
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const { t } = useTranslation();

  const isPending = !request.decision;
  const isAllowed = request.decision === 'allow';

  // 60s auto-deny timeout for pending requests
  useEffect(() => {
    if (!isPending) return;
    const timer = setTimeout(() => {
      onDecide(request.requestId, 'deny', 'timeout');
    }, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isPending, request.requestId, onDecide]);

  const handleAllow = useCallback(() => {
    const reason = alwaysAllow ? 'always-allow-type' : undefined;
    onDecide(request.requestId, 'allow', reason);
  }, [onDecide, request.requestId, alwaysAllow]);

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
        <RiskBadge risk={request.riskLevel} />
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

      {/* "Always allow this type" checkbox */}
      {isPending && (
        <label className={styles.alwaysAllowLabel}>
          <span
            className={styles.checkbox}
            onClick={() => setAlwaysAllow((v) => !v)}
            role="checkbox"
            aria-checked={alwaysAllow}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setAlwaysAllow((v) => !v);
              }
            }}
          >
            {alwaysAllow ? <CheckSquare size={14} /> : <Square size={14} />}
          </span>
          <span className={styles.alwaysAllowText}>Always allow this type</span>
        </label>
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
