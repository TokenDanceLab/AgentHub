import React, { type HTMLAttributes } from 'react';
import styles from './Avatar.module.css';

type AvatarVariant = 'default' | 'brand';
type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  initials: string;
  size?: AvatarSize;
  variant?: AvatarVariant;
}

export function Avatar({
  initials,
  size = 'md',
  variant = 'default',
  className,
  ...props
}: AvatarProps) {
  const cls = [styles.avatar, styles[size], variant === 'brand' ? styles.brand : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} aria-hidden="true" {...props}>
      {initials.slice(0, 2).toUpperCase()}
    </div>
  );
}
