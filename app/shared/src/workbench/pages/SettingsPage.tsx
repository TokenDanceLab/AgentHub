import React from 'react';
import { DesignNavIcon } from '../designIcons';
import { RecoveryPanel, StatusNotice } from '../../ui';
import styles from './SettingsPage.module.css';
import {
  NAV_ITEMS,
  NavGlyph,
  PANE_META,
  PANE_RENDERERS,
  SettingsScopeRow,
} from './settings';
import type { SettingsPageProps } from './settings';

/* ═══════════════════════════════════════════════════════════════════════
   SettingsPage — AgentHub v4

   Left nav (sections + scope) + right main (settings rows + state preview).
   Pane content / shared controls extracted under ./settings for Phase 18 #572.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  SettingsPageProps,
  SettingsPaneId,
  StatePanelKind,
} from './settings';

/* ═══════════════════════════════════════════════════════════════════════
   Main export
   ═══════════════════════════════════════════════════════════════════════ */

export function SettingsPage(props: SettingsPageProps): React.ReactElement {
  const {
    activePane,
    spaceTitle,
    spaceMeta,
    onSelectPane,
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
    <section className={`${styles.page} workbench settings-page`}>
      {/* ── Left nav ── */}
      <aside className={`${styles.nav} workbench-nav`}>
        <div className={`${styles.navTitle} workbench-title`}>设置</div>
        <input
          className={`${styles.navSearch} workbench-search`}
          type="search"
          placeholder="搜索设置项"
        />
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`${styles.navRow}${activePane === item.id ? ` ${styles.navRowActive}` : ''}`}
            type="button"
            onClick={() => onSelectPane(item.id)}
          >
            <NavGlyph name={item.glyph} />
            {item.label}
          </button>
        ))}
        <div className={styles.navCaption}>当前空间</div>
        <SettingsScopeRow title={spaceTitle} meta={spaceMeta} />
        <SettingsScopeRow title="TokenDance" meta="组织空间" />
        <SettingsScopeRow title={props.currentUserDisplayName ?? '未登录'} meta="当前用户" />
      </aside>

      {/* ── Right main ── */}
      <main className={`${styles.main} workbench-main`}>
        <div className={`${styles.head} workbench-head`}>
          <div>
            <h1 className={styles.headTitle}>{meta.title}</h1>
            <p className={styles.headSubcopy}>{meta.description}</p>
          </div>
          <button className={`${styles.iconAction} icon-action`} type="button" aria-label="设置更多">
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
              title="设置加载失败"
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
    </section>
  );
}
