import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import type { UserProfile } from '@/api/hubClient';
import styles from './AuthPage.module.css';

interface LoginFormProps {
  onSuccess: (user: UserProfile) => void;
  onSwitchToRegister: () => void;
}

interface FieldErrors {
  username?: string;
  password?: string;
}

const USERNAME_MIN = 3;
const PASSWORD_MIN = 8;

function validate(
  username: string,
  password: string,
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
  return errors;
}

export default function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const { t } = useTranslation();
  const { login, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Once the auth state updates with a user, notify parent
  if (user) {
    onSuccess(user);
    return null;
  }

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
      const errs = validate(username, password, t);
      setFieldErrors(errs);
      if (Object.keys(errs).length > 0) return;

      setLoading(true);
      try {
        await login(username.trim(), password);
        // onSuccess will be called on next render when `user` is populated
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        if (
          message.includes('401') ||
          message.includes('credential') ||
          message.includes('invalid')
        ) {
          setServerError(t('auth.error.invalidCredentials'));
        } else if (message.includes('Network') || message.includes('fetch')) {
          setServerError(t('auth.error.networkError'));
        } else {
          setServerError(message || t('auth.error.invalidCredentials'));
        }
      } finally {
        setLoading(false);
      }
    },
    [username, password, login, t],
  );

  return (
    <form className={styles.body} onSubmit={handleSubmit} noValidate>
      {serverError && (
        <div className={styles.errorBanner} role="alert">
          <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          {serverError}
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="login-username">
          {t('auth.username')}
        </label>
        <input
          id="login-username"
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
        <label className={styles.label} htmlFor="login-password">
          {t('auth.password')}
        </label>
        <div className={styles.passwordWrapper}>
          <input
            id="login-password"
            className={`${styles.input} ${fieldErrors.password ? styles.inputError : ''}`}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
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

      <button className={styles.submitButton} type="submit" disabled={loading}>
        {loading ? (
          <>
            <Loader2 size={16} className={styles.spinner} aria-hidden="true" />
            {t('auth.loginButton')}
          </>
        ) : (
          t('auth.loginButton')
        )}
      </button>

      <div className={styles.switch}>
        <button
          type="button"
          className={styles.switchButton}
          onClick={onSwitchToRegister}
          disabled={loading}
        >
          {t('auth.switchToRegister')}
        </button>
      </div>
    </form>
  );
}
