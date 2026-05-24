import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { createHubClient } from '@/api/hubClient';
import styles from './AuthPage.module.css';

interface RegisterFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

interface FieldErrors {
  username?: string;
  nickname?: string;
  password?: string;
  confirmPassword?: string;
}

const USERNAME_MIN = 3;
const PASSWORD_MIN = 8;

function validate(
  username: string,
  _nickname: string,
  password: string,
  confirmPassword: string,
  t: (key: string) => string,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!username.trim()) {
    errors.username = t('auth.error.required');
  } else if (username.trim().length < USERNAME_MIN) {
    errors.username = t('auth.error.usernameMin');
  }
  if (!password) {
    errors.password = t('auth.error.required');
  } else if (password.length < PASSWORD_MIN) {
    errors.password = t('auth.error.passwordMin');
  }
  if (password && confirmPassword !== password) {
    errors.confirmPassword = t('auth.error.passwordMismatch');
  }
  return errors;
}

export default function RegisterForm({ onSuccess, onSwitchToLogin }: RegisterFormProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState(false);

  const clearFieldError = useCallback((field: keyof FieldErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setServerError(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setServerError(null);
      const trimmedUsername = username.trim();
      const trimmedNickname = nickname.trim() || trimmedUsername;
      const errs = validate(trimmedUsername, trimmedNickname, password, confirmPassword, t);
      setFieldErrors(errs);
      if (Object.keys(errs).length > 0) return;

      setLoading(true);
      try {
        const client = createHubClient();
        await client.register({
          username: trimmedUsername,
          password,
          nickname: trimmedNickname,
        });
        setSuccess(true);
        // Give a brief moment for the success animation, then notify parent
        setTimeout(() => {
          onSuccess();
        }, 50);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('409') || message.includes('taken') || message.includes('exists')) {
          setServerError(t('auth.error.registerFailed'));
        } else if (message && (message.includes('Network') || message.includes('fetch'))) {
          setServerError(t('auth.error.networkError'));
        } else {
          setServerError(message || t('auth.error.registerFailed'));
        }
      } finally {
        setLoading(false);
      }
    },
    [username, nickname, password, confirmPassword, t, onSuccess],
  );

  // Success state: show confirmation then auto-switch
  if (success) {
    return (
      <div className={styles.body}>
        <div className={styles.successBox}>
          <CheckCircle size={40} className={styles.successIcon} />
          <p className={styles.successText}>{t('auth.registerSuccess')}</p>
        </div>
        <button className={styles.submitButton} type="button" onClick={onSwitchToLogin}>
          {t('auth.loginButton')}
        </button>
      </div>
    );
  }

  return (
    <form className={styles.body} onSubmit={handleSubmit} noValidate>
      {serverError && (
        <div className={styles.errorBanner} role="alert">
          <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          {serverError}
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="reg-username">
          {t('auth.username')}
        </label>
        <input
          id="reg-username"
          className={`${styles.input} ${fieldErrors.username ? styles.inputError : ''}`}
          type="text"
          autoComplete="username"
          placeholder={t('auth.usernamePlaceholder')}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            clearFieldError('username');
          }}
          autoFocus
          disabled={loading}
        />
        {fieldErrors.username && (
          <span className={styles.error} role="alert">{fieldErrors.username}</span>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="reg-nickname">
          {t('auth.nickname')}
        </label>
        <input
          id="reg-nickname"
          className={styles.input}
          type="text"
          autoComplete="name"
          placeholder={t('auth.nicknamePlaceholder')}
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            clearFieldError('nickname');
          }}
          disabled={loading}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="reg-password">
          {t('auth.password')}
        </label>
        <div className={styles.passwordWrapper}>
          <input
            id="reg-password"
            className={`${styles.input} ${fieldErrors.password ? styles.inputError : ''}`}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearFieldError('password');
            }}
            disabled={loading}
          />
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {fieldErrors.password && (
          <span className={styles.error} role="alert">{fieldErrors.password}</span>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="reg-confirm">
          {t('auth.confirmPassword')}
        </label>
        <div className={styles.passwordWrapper}>
          <input
            id="reg-confirm"
            className={`${styles.input} ${fieldErrors.confirmPassword ? styles.inputError : ''}`}
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('auth.confirmPasswordPlaceholder')}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              clearFieldError('confirmPassword');
            }}
            disabled={loading}
          />
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setShowConfirm((v) => !v)}
            tabIndex={-1}
            aria-label={showConfirm ? 'Hide password' : 'Show password'}
          >
            {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {fieldErrors.confirmPassword && (
          <span className={styles.error} role="alert">{fieldErrors.confirmPassword}</span>
        )}
      </div>

      <button className={styles.submitButton} type="submit" disabled={loading}>
        {loading ? (
          <>
            <Loader2 size={16} className={styles.spinner} aria-hidden="true" />
            {t('auth.registerButton')}
          </>
        ) : (
          t('auth.registerButton')
        )}
      </button>

      <div className={styles.switch}>
        <button
          type="button"
          className={styles.switchButton}
          onClick={onSwitchToLogin}
          disabled={loading}
        >
          {t('auth.switchToLogin')}
        </button>
      </div>
    </form>
  );
}
