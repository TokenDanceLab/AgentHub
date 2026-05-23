import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import type { ToastItem, ToastType } from '@/stores/toastStore';
import styles from './Toast.module.css';

const TOAST_ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const variantClass: Record<ToastType, string> = {
  success: styles.success,
  error: styles.error,
  warning: styles.warning,
  info: styles.info,
};

function Toast({ toast }: { toast: ToastItem }) {
  const dismissToast = useToastStore((s) => s.dismissToast);
  const Icon = TOAST_ICONS[toast.type];

  return (
    <div
      className={`${styles.toast} ${variantClass[toast.type]}${toast.exiting ? ` ${styles.exiting}` : ''}`}
      role="alert"
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
        aria-label="Close notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container} aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
