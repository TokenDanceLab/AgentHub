/* ═══════════════════════════════════════════════════════════════════════
   Settings main pane cluster — head, load/error status, and active pane.

   Extracted from SettingsPage as Phase 21 residual thin #604.
   CSS remains on shared SettingsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { DesignNavIcon } from '../../designIcons';
import { RecoveryPanel, StatusNotice } from '../../../ui';
import styles from '../SettingsPage.module.css';
import { PANE_RENDERERS } from './SettingsPanes';
import { PANE_META } from './types';
import type { SettingsPageProps } from './types';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../../../chatview/i18n/resources';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';

export type SettingsMainProps = SettingsPageProps;

export function SettingsMain(props: SettingsMainProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const {
    activePane,
    settingsLoading = false,
    settingsError = null,
    settingsErrorKind = null,
    onRetrySettingsLoad,
    onDismissSettingsError,
  } = props;
  const meta = PANE_META[activePane] ?? PANE_META.appearance;
  const PaneContent = PANE_RENDERERS[activePane] ?? PANE_RENDERERS.appearance;
  const showInitRecovery = Boolean(settingsError) && settingsErrorKind === 'init' && !settingsLoading;
  const showWriteNotice = Boolean(settingsError) && settingsErrorKind === 'write' && !settingsLoading;
  const showLoadingNotice = settingsLoading;

  return (
    <main className={`${styles.main} workbench-main`}>
      <div className={`${styles.head} workbench-head`}>
        <div>
          <h1 className={styles.headTitle}>{meta.title}</h1>
          <p className={styles.headSubcopy}>{meta.description}</p>
        </div>
        <button className={`${styles.iconAction} icon-action`} type="button" aria-label={t("aria.settingsMore")}>
          <DesignNavIcon name="settings" size={16} />
        </button>
      </div>

      {showLoadingNotice ? (
        <div className={styles.statusStack}>
          <StatusNotice
            {...(styles.statusNotice ? { className: styles.statusNotice } : {})}
            icon={<DesignNavIcon name="running" size={14} />}
            role="status"
          >
            正在加载设置…
          </StatusNotice>
        </div>
      ) : null}

      {showWriteNotice && settingsError ? (
        <div className={styles.statusStack}>
          <StatusNotice
            {...(styles.statusNotice ? { className: styles.statusNotice } : {})}
            icon={<DesignNavIcon name="error404" size={14} />}
            role="alert"
            {...(onDismissSettingsError
              ? {
                  action: (
                    <button
                      type="button"
                      className={styles.statusAction}
                      onClick={onDismissSettingsError}
                    >
                      关闭
                    </button>
                  ),
                }
              : {})}
          >
            设置未能保存：{settingsError}
          </StatusNotice>
        </div>
      ) : null}

      {showInitRecovery && settingsError ? (
        <div className={styles.statusStack}>
          <RecoveryPanel
            {...(styles.recoveryPanel ? { className: styles.recoveryPanel } : {})}
            icon={<DesignNavIcon name="error404" size={18} />}
            eyebrow="Settings recovery"
            title={tw("settings.loadFailed")}
            description="无法从当前平台适配器读取已保存的设置。页面会暂时使用默认值，重试后可恢复远端偏好。"
            meta={settingsError}
            primaryAction={{
              label: '重试加载',
              busyLabel: '重试中…',
              busy: settingsLoading,
              icon: <DesignNavIcon name="refresh" size={14} />,
              onClick: () => {
                onRetrySettingsLoad?.();
              },
              disabled: !onRetrySettingsLoad,
            }}
            {...(onDismissSettingsError
              ? {
                  secondaryAction: {
                    label: '继续使用默认值',
                    onClick: onDismissSettingsError,
                  },
                }
              : {})}
          />
        </div>
      ) : null}

      <PaneContent {...props} />
    </main>
  );
}
