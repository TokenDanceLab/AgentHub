import styles from './primitives.module.css';

interface CapabilityCardProps {
  title: string;
  description: string;
  status: string;
}

export default function CapabilityCard({ title, description, status }: CapabilityCardProps) {
  return (
    <div className={styles.capabilityCard}>
      <strong>{title}</strong>
      <span>{description}</span>
      <em>{status}</em>
    </div>
  );
}
