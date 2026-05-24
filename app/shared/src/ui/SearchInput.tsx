import type { InputHTMLAttributes } from 'react';
import { Icon } from './Icon';
import styles from './SearchInput.module.css';

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  placeholder?: string;
}

export function SearchInput({ placeholder = 'Search...', className, id, ...props }: SearchInputProps) {
  const inputId = id ?? 'search-input';

  return (
    <div className={styles.wrapper}>
      <label htmlFor={inputId} className={styles.icon}>
        <Icon name="search" size={18} />
      </label>
      <input
        id={inputId}
        className={[styles.input, className].filter(Boolean).join(' ')}
        type="search"
        placeholder={placeholder}
        {...props}
      />
    </div>
  );
}
