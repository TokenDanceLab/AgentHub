import { Archive } from 'lucide-react';
import styles from './primitives.module.css';

interface EmptyBlockProps {
  title: string;
  description: string;
}

export default function EmptyBlock({ title, description }: EmptyBlockProps) {
  return (
    <div className={styles.emptyBlock}>
      <Archive size={24} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
