import React from 'react';
import styles from './DateDivider.module.css';

interface DateDividerProps {
  date: string;
}

export const DateDivider: React.FC<DateDividerProps> = ({ date }) => {
  return <div className={styles.divider} data-date-divider>{date}</div>;
};
