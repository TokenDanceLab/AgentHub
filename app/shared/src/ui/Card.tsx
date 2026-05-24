import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'elevated';
  padding?: 'normal' | 'compact' | 'none';
  children: ReactNode;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', padding = 'normal', children, ...props }, ref) => {
    const variantClass = variant === 'glass' ? styles.glass
      : variant === 'elevated' ? styles.elevated : '';
    const padClass = padding === 'compact' ? styles.compact
      : padding === 'none' ? styles.padNone : '';
    return (
      <div ref={ref} className={`${styles.card} ${variantClass} ${padClass} ${className ?? ''}`} {...props}>
        {children}
      </div>
    );
  },
);
Card.displayName = 'Card';

function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${styles.header} ${className ?? ''}`} {...props}>{children}</div>;
}
CardHeader.displayName = 'CardHeader';

function CardContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${styles.content} ${className ?? ''}`} {...props}>{children}</div>;
}
CardContent.displayName = 'CardContent';

function CardFooter({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${styles.footer} ${className ?? ''}`} {...props}>{children}</div>;
}
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardContent, CardFooter };
