import { Menu, X, PanelRightClose, PanelRightOpen, Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './MobileToolbar.module.css';

interface MobileToolbarProps {
  title: string;
  isMobile: boolean;
  isTablet: boolean;
  mobileSidebarOpen: boolean;
  mobileRunDetailOpen: boolean;
  tabletAgentOpen: boolean;
  onToggleSidebar: () => void;
  onToggleAgent: () => void;
  onToggleRunDetail: () => void;
}

export default function MobileToolbar({
  title,
  isMobile,
  isTablet,
  mobileSidebarOpen,
  mobileRunDetailOpen,
  tabletAgentOpen,
  onToggleSidebar,
  onToggleAgent,
  onToggleRunDetail,
}: MobileToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.mobileToolbar}>
      {isMobile && (
        <button
          className={styles.mobileToggle}
          onClick={onToggleSidebar}
          aria-label={mobileSidebarOpen ? t('nav.closeSidebar') : t('nav.openSidebar')}
          aria-expanded={mobileSidebarOpen}
        >
          {mobileSidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      )}
      {isTablet && (
        <button
          className={styles.mobileToggle}
          onClick={onToggleAgent}
          aria-label={tabletAgentOpen ? t('agent.close') : t('agent.open')}
          aria-expanded={tabletAgentOpen}
        >
          {tabletAgentOpen ? <X size={20} /> : <Bot size={20} />}
        </button>
      )}
      <span className={styles.mobileTitle}>{title}</span>
      <button
        className={styles.mobileToggle}
        onClick={onToggleRunDetail}
        aria-label={mobileRunDetailOpen ? t('run.close') : t('run.open')}
        aria-expanded={mobileRunDetailOpen}
      >
        {mobileRunDetailOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
      </button>
    </div>
  );
}
