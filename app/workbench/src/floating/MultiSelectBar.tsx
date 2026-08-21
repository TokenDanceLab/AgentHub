import React from 'react';
import { DesignNavIcon, type DesignNavIconName } from '../designIcons';
import { Tooltip } from '@shared/ui/Tooltip';
import styles from './MultiSelectBar.module.css';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';

export interface MultiSelectBarAction {
  label: string;
  icon?: DesignNavIconName | undefined;
  danger?: boolean;
  ghost?: boolean;
  onClick: () => void;
}

export interface MultiSelectBarProps {
  count: number;
  actions: Array<MultiSelectBarAction>;
  total: number;
  workspaceLeft?: number | undefined;
  workspaceWidth?: number | undefined;
}

export const MultiSelectBar: React.FC<MultiSelectBarProps> = ({
  actions,
  count,
  total,
  workspaceLeft,
  workspaceWidth,
}) => {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const style = {
    ...(workspaceLeft !== undefined ? { '--selectbar-left': `${Math.round(workspaceLeft)}px` } : {}),
    ...(workspaceWidth !== undefined ? { '--selectbar-width': `${Math.round(workspaceWidth)}px` } : {}),
  } as React.CSSProperties;
  const modeLabel = count ? '已选择' : '框选模式';

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={t("aria.multiSelectBar")}
      style={style}
    >
      <div className={styles.count}>
        <span className={styles.countNum}>{count}</span> {modeLabel}{' '}
        <em className={styles.countTotal}>/ {total}</em>
      </div>
      {actions.map((action, i) => (
        <Tooltip key={i} label={action.label}>
          <button
            aria-label={action.label}
            className={[
              styles.action,
              action.danger ? styles.danger : '',
              action.ghost ? styles.ghost : '',
            ].filter(Boolean).join(' ')}
            type="button"
            onClick={action.onClick}
          >
            {action.icon && <DesignNavIcon name={action.icon} size={15} />}
            <span>{action.label}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
};
