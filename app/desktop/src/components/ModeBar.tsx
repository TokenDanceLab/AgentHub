import { Bot, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './ModeBar.module.css';

interface ModeBarProps {
  viewMode: 'agent' | 'im';
  onChange: (mode: 'agent' | 'im') => void;
}

export default function ModeBar({ viewMode, onChange }: ModeBarProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.modeBar}>
      <button
        className={`${styles.modeTab} ${viewMode === 'agent' ? styles.modeTabActive : ''}`}
        onClick={() => onChange('agent')}
        aria-pressed={viewMode === 'agent'}
      >
        <Bot size={14} />
        <span>{t('nav.agent')}</span>
      </button>
      <button
        className={`${styles.modeTab} ${viewMode === 'im' ? styles.modeTabActive : ''}`}
        onClick={() => onChange('im')}
        aria-pressed={viewMode === 'im'}
      >
        <MessageSquare size={14} />
        <span>{t('nav.messages')}</span>
      </button>
    </div>
  );
}
