import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './IMSearchBar.module.css';

interface IMSearchBarProps {
  onSearch?: ((query: string) => void) | undefined;
  onClear?: (() => void) | undefined;
  placeholder?: string;
}

const IMSearchBar = memo(function IMSearchBar({ onSearch, onClear, placeholder }: IMSearchBarProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setValue(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch?.(next.trim());
      }, 300);
    },
    [onSearch],
  );

  const handleClear = useCallback(() => {
    setValue('');
    onClear?.();
    inputRef.current?.focus();
  }, [onClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        handleClear();
      }
    },
    [handleClear],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className={styles.root}>
      <Search size={14} className={styles.icon} />
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? t('im.search')}
        aria-label={t('im.search')}
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          onClick={handleClear}
          aria-label={t('im.searchClear')}
          title={t('im.searchClear')}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
});

export default IMSearchBar;
