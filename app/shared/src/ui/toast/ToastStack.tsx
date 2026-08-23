import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToastStore } from './toastStore';
import type { ToastItem, ToastType } from './toastStore';
import { CHATVIEW_I18N_NAMESPACE } from '../../chatview/i18n/resources';
import styles from './ToastStack.module.css';

const TOAST_ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const variantClass: Record<ToastType, string> = {
  success: styles.success ?? '',
  error: styles.error ?? '',
  warning: styles.warning ?? '',
  info: styles.info ?? '',
};

// info/success are non-urgent → polite; error/warning interrupt → assertive.
const liveRegion: Record<ToastType, 'polite' | 'assertive'> = {
  success: 'polite',
  info: 'polite',
  error: 'assertive',
  warning: 'assertive',
};

function Toast({ toast }: { toast: ToastItem }) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const dismissToast = useToastStore((s) => s.dismissToast);
  const pauseAutoDismiss = useToastStore((s) => s.pauseAutoDismiss);
  const resumeAutoDismiss = useToastStore((s) => s.resumeAutoDismiss);
  const Icon = TOAST_ICONS[toast.type];

  return (
    <div
      className={`${styles.toast} ${variantClass[toast.type]}${toast.exiting ? ` ${styles.exiting}` : ''}`}
      aria-live={liveRegion[toast.type]}
      onMouseEnter={() => pauseAutoDismiss(toast.id)}
      onMouseLeave={() => resumeAutoDismiss(toast.id)}
      onFocus={() => pauseAutoDismiss(toast.id)}
      onBlur={() => resumeAutoDismiss(toast.id)}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className={styles.body}>
        <span className={styles.message}>{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            className={styles.action}
            onClick={toast.action.onClick}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className={styles.close}
        onClick={() => dismissToast(toast.id)}
        aria-label={t('ui.closeNotification', 'Close notification')}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container} aria-label={t('aria.notifications', 'Notifications')} aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
