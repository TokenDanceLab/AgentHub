import { useEffect, useState } from "react";
import { getSurfaceStatusMetadata, getSurfacesByPlatform } from "@agenthub/shared";
import { ActivityCard, BottomSheet, SegmentedControl, StatusNotice, TokenDanceMark } from "@agenthub/shared/ui";
import { Bell, Languages, Link2, LogIn, Palette, RefreshCw, ShieldCheck, Smartphone, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { mobileLanguages, type MobileLanguage } from "../i18n";
import {
  clearHubAccessToken,
  readHubAccessToken,
  sendMobileNotificationProbe,
  startMobileOidcLogin,
} from "../native/mobileCommands";
import { getNotifyPrefs, setNotifyEnabled, type NotifyEventType } from "../utils/notifyPrefs";

type ThemeMode = "system" | "light" | "dark" | "oled";
const THEME_STORAGE_KEY = "agenthub.mobile.theme";

const themeModes: { value: ThemeMode; labelKey: string }[] = [
  { value: "system", labelKey: "settings.theme.system" },
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
  { value: "oled", labelKey: "settings.theme.oled" },
];

function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "oled") return stored;
  } catch {
    // Storage blocked; fall back to system.
  }
  return "system";
}

function getThemeMetaColor(theme: ThemeMode): string {
  if (theme === "light") return "#f5f5f7";
  if (theme === "dark") return "#1f1f27";
  if (theme === "oled") return "#000000";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "#1f1f27" : "#f5f5f7";
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = getThemeMetaColor(theme);
  }
}

type NativeStatusKey =
  | "settings.status.idle"
  | "settings.status.startingLogin"
  | "settings.status.loginStarted"
  | "settings.status.checkingSession"
  | "settings.status.sessionPresent"
  | "settings.status.sessionMissing"
  | "settings.status.requestingNotifications"
  | "settings.status.notificationSent"
  | "settings.status.notificationDenied"
  | "settings.status.clearingSession"
  | "settings.status.sessionCleared"
  | "settings.status.nativeBridgeUnavailable";

type NativeActionKind = "login" | "session" | "notification";

export function AccountView() {
  const { t, i18n } = useTranslation();
  const [statusKey, setStatusKey] = useState<NativeStatusKey>("settings.status.idle");
  const [isBusy, setIsBusy] = useState(false);
  const [lastNativeAction, setLastNativeAction] = useState<NativeActionKind>("login");
  const [clearSheetOpen, setClearSheetOpen] = useState(false);
  const [clearSheetStatusKey, setClearSheetStatusKey] = useState<NativeStatusKey>("settings.status.idle");
  const [isClearBusy, setIsClearBusy] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [notifyPrefs, setNotifyPrefs] = useState(getNotifyPrefs);
  const canRetryNativeAction = statusKey === "settings.status.nativeBridgeUnavailable";
  const currentLanguage: MobileLanguage = i18n.language?.startsWith("zh") ? "zh" : "en";
  const mobileSurfaces = getSurfacesByPlatform("mobile");

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage blocked; theme still applies in memory.
    }
  }, [theme]);

  // Re-apply meta theme-color when system preference changes while in system mode
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      applyTheme("system");
    }
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [theme]);
  const readinessItems = [
    {
      icon: <Link2 size={16} />,
      title: t("settings.readiness.tokenDanceId"),
      description: t("settings.readiness.deepLinkPending"),
      state: t("settings.readiness.deepLink"),
    },
    {
      icon: <Smartphone size={16} />,
      title: t("settings.readiness.hubSession"),
      description: t("settings.readiness.nativeCommandWired"),
      state: t("settings.readiness.secureStore"),
    },
    {
      icon: <Bell size={16} />,
      title: t("settings.readiness.notifications"),
      description: t("settings.readiness.permissionGate"),
      state: t("settings.readiness.localProbe"),
    },
  ];

  async function runNativeAction(action: () => Promise<NativeStatusKey>, pendingKey: NativeStatusKey, actionKind: NativeActionKind) {
    setLastNativeAction(actionKind);
    setIsBusy(true);
    setStatusKey(pendingKey);
    try {
      setStatusKey(await action());
    } catch {
      setStatusKey("settings.status.nativeBridgeUnavailable");
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmClearSession() {
    setIsClearBusy(true);
    setClearSheetStatusKey("settings.status.clearingSession");
    setStatusKey("settings.status.clearingSession");
    try {
      await clearHubAccessToken();
      setClearSheetStatusKey("settings.status.sessionCleared");
      setStatusKey("settings.status.sessionCleared");
      setClearSheetOpen(false);
    } catch {
      setClearSheetStatusKey("settings.status.nativeBridgeUnavailable");
      setStatusKey("settings.status.nativeBridgeUnavailable");
    } finally {
      setIsClearBusy(false);
    }
  }

  return (
    <div className="mobileView">
      <header className="mobileHeader">
        <div>
          <p className="mobileEyebrow">{t("settings.eyebrow")}</p>
          <h1>{t("settings.title")}</h1>
        </div>
      </header>

      <div className="mobileScroll">
        <div className="mobileSettingStack">
          <section className="mobileAccountIdentityPanel" aria-label={t("settings.account.title")}>
            <div className="mobileAccountIdentityHeader">
              <TokenDanceMark className="mobileAccountIdentityLogo" />
              <div className="mobileAccountIdentityCopy">
                <p className="mobileEyebrow">{t("settings.account.title")}</p>
                <h2>{t("common.appName")}</h2>
                <span>{t("settings.account.description")}</span>
              </div>
            </div>
            <div className="mobileAccountIdentityMeta" aria-label={t("settings.readiness.aria")}>
              <span>{t("settings.readiness.tokenDanceId")}</span>
              <span>{t("settings.readiness.secureStore")}</span>
              <span>{t("settings.status.nativeAction")}</span>
            </div>
            <div className="mobileSettingActions">
              <button
                className="mobileActionButton"
                type="button"
                disabled={isBusy}
                onClick={() => void runNativeAction(async () => {
                  await startMobileOidcLogin();
                  return "settings.status.loginStarted";
                }, "settings.status.startingLogin", "login")}
              >
                <LogIn size={16} />
                <span>{t("settings.account.signIn")}</span>
              </button>
              <button
                className="mobileActionButton"
                type="button"
                disabled={isBusy}
                onClick={() => void runNativeAction(async () => {
                  const token = await readHubAccessToken();
                  return token ? "settings.status.sessionPresent" : "settings.status.sessionMissing";
                }, "settings.status.checkingSession", "session")}
              >
                <ShieldCheck size={16} />
                <span>{t("settings.account.checkSession")}</span>
              </button>
              <button
                className="mobileActionButton"
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setClearSheetStatusKey("settings.status.idle");
                  setClearSheetOpen(true);
                }}
              >
                <Trash2 size={16} />
                <span>{t("settings.account.clear")}</span>
              </button>
            </div>
          </section>

          <section className="mobileOverviewPanel" aria-label={t("settings.readiness.aria")}>
            <p className="mobileEyebrow">{t("settings.readiness.eyebrow")}</p>
            <h2>{t("settings.readiness.title")}</h2>
            <div className="mobileReadinessGrid">
              {readinessItems.map((item) => (
                <ActivityCard
                  key={item.title}
                  className="mobileReadinessRow"
                  icon={item.icon}
                  iconClassName="mobileReadinessIcon"
                  bodyClassName="mobileReadinessBody"
                  metaClassName="mobileReadinessMeta"
                  label={item.title}
                  actions={<span className="mobileReadinessState">{item.state}</span>}
                >
                  {item.description}
                </ActivityCard>
              ))}
            </div>
            <StatusNotice
              className="mobileSignalRow"
              icon={isBusy ? <RefreshCw size={14} className="mobileSpin" /> : <ShieldCheck size={14} />}
            >
              {t(statusKey)}
            </StatusNotice>
            {canRetryNativeAction && (
              <button
                className="mobileActionButton mobileRetryAction"
                type="button"
                disabled={isBusy}
                onClick={() => void runNativeAction(async () => {
                  if (lastNativeAction === "session") {
                    const token = await readHubAccessToken();
                    return token ? "settings.status.sessionPresent" : "settings.status.sessionMissing";
                  }
                  if (lastNativeAction === "notification") {
                    const granted = await sendMobileNotificationProbe();
                    return granted ? "settings.status.notificationSent" : "settings.status.notificationDenied";
                  }
                  await startMobileOidcLogin();
                  return "settings.status.loginStarted";
                }, lastNativeAction === "session"
                  ? "settings.status.checkingSession"
                  : lastNativeAction === "notification"
                    ? "settings.status.requestingNotifications"
                    : "settings.status.startingLogin", lastNativeAction)}
              >
                <RefreshCw size={16} />
                <span>
                  {lastNativeAction === "session"
                    ? t("settings.status.retryCheck")
                    : lastNativeAction === "notification"
                      ? t("settings.status.retryAlert")
                      : t("settings.status.retrySignIn")}
                </span>
              </button>
            )}
          </section>

          <section className="mobileSettingCard">
            <div className="mobileSettingHeader">
              <div>
                <h3>{t("settings.surfaces.title")}</h3>
                <p>{t("settings.surfaces.description")}</p>
              </div>
              <span className="mobileSettingBadge">{t("settings.surfaces.count", { count: mobileSurfaces.length })}</span>
            </div>
            <div className="mobileSurfaceRegistry" aria-label={t("settings.surfaces.title")}>
              {mobileSurfaces.map((surface) => {
                const status = getSurfaceStatusMetadata(surface.defaultStatus);
                return (
                  <ActivityCard
                    key={surface.id}
                    className="mobileSurfaceRegistryRow"
                    bodyClassName="mobileSurfaceRegistryBody"
                    metaClassName="mobileSurfaceRegistryMeta"
                    actionsClassName="mobileSurfaceRegistryActions"
                    label={t(surface.labelKey)}
                    actions={<span className="mobileSurfaceRegistryState">{t(status.labelKey)}</span>}
                  >
                    {t(surface.descriptionKey)}
                  </ActivityCard>
                );
              })}
            </div>
          </section>

          <section className="mobileSettingCard">
            <div className="mobileSettingHeader">
              <div>
                <h3>{t("settings.language.title")}</h3>
                <p>{t("settings.language.description")}</p>
              </div>
              <span className="mobileSettingBadge">
                {t("settings.language.current")}: {currentLanguage === "zh" ? t("settings.language.chinese") : t("settings.language.english")}
              </span>
            </div>
            <SegmentedControl
              ariaLabel={t("settings.language.title")}
              value={currentLanguage}
              onChange={(language) => void i18n.changeLanguage(language)}
              className="mobileSegmentedToolbar mobileLanguageToolbar"
              optionClassName="mobileSegmentButton"
              activeOptionClassName="mobileSegmentButtonActive"
              options={mobileLanguages.map((language) => ({
                value: language.code,
                label: language.code === "zh" ? t("settings.language.chinese") : t("settings.language.english"),
                icon: <Languages size={14} />,
              }))}
            />
          </section>

          <section className="mobileSettingCard">
            <div className="mobileSettingHeader">
              <div>
                <h3>{t("settings.theme.title")}</h3>
                <p>{t("settings.theme.description")}</p>
              </div>
              <span className="mobileSettingBadge">{t(`settings.theme.${theme}`)}</span>
            </div>
            <SegmentedControl
              ariaLabel={t("settings.theme.title")}
              value={theme}
              onChange={(value) => setTheme(value as ThemeMode)}
              className="mobileSegmentedToolbar"
              optionClassName="mobileSegmentButton"
              activeOptionClassName="mobileSegmentButtonActive"
              options={themeModes.map((mode) => ({
                value: mode.value,
                label: t(mode.labelKey),
                icon: <Palette size={14} />,
              }))}
            />
          </section>

          <section className="mobileSettingCard">
            <h3>{t("settings.notifications.title")}</h3>
            <p>{t("settings.notifications.description")}</p>
            <div className="mobileNotifyPrefList">
              {([
                { key: "run_completed" as NotifyEventType, labelKey: "settings.notifications.runCompleted" },
                { key: "run_failed" as NotifyEventType, labelKey: "settings.notifications.runFailed" },
                { key: "approval_needed" as NotifyEventType, labelKey: "settings.notifications.approvalNeeded" },
              ]).map(({ key, labelKey }) => (
                <label key={key} className="mobileNotifyPrefRow">
                  <span>{t(labelKey)}</span>
                  <input
                    type="checkbox"
                    className="mobileToggle"
                    checked={notifyPrefs[key]}
                    onChange={(e) => {
                      const enabled = e.currentTarget.checked;
                      setNotifyEnabled(key, enabled);
                      setNotifyPrefs((prev) => ({ ...prev, [key]: enabled }));
                    }}
                  />
                </label>
              ))}
            </div>
            <button
              className="mobileActionButton"
              type="button"
              disabled={isBusy}
              onClick={() => void runNativeAction(async () => {
                const granted = await sendMobileNotificationProbe();
                return granted ? "settings.status.notificationSent" : "settings.status.notificationDenied";
              }, "settings.status.requestingNotifications", "notification")}
            >
              <Bell size={16} />
              <span>{t("settings.notifications.testAlert")}</span>
            </button>
          </section>

          <section className="mobileSettingCard">
            <h3>{t("settings.about.title")}</h3>
            <p>{t("settings.about.version")}</p>
            <p>{t("settings.about.description")}</p>
          </section>
        </div>
      </div>

      {clearSheetOpen && (
        <BottomSheet
          ariaLabel={t("settings.clearSession.aria")}
          title={t("settings.clearSession.title")}
          closeLabel={t("settings.clearSession.close")}
          eyebrow={t("settings.clearSession.eyebrow")}
          description={t("settings.clearSession.description")}
          closeIcon={<X size={18} />}
          closeDisabled={isClearBusy}
          onClose={() => {
            if (!isClearBusy) {
              setClearSheetOpen(false);
            }
          }}
          layerClassName="mobileSheetLayer"
          scrimClassName="mobileSheetScrim"
          sheetClassName="mobileBottomSheet"
          handleClassName="mobileSheetHandle"
          headerClassName="mobileSheetHeader"
          eyebrowClassName="mobileEyebrow"
          closeButtonClassName="mobileIconButton"
          descriptionClassName="mobileSheetDescription"
          footerClassName="mobileSheetActions"
          footer={(
            <>
              <button
                className="mobileActionButton"
                type="button"
                disabled={isClearBusy}
                onClick={() => setClearSheetOpen(false)}
              >
                <span>{t("settings.clearSession.cancel")}</span>
              </button>
              <button
                className="mobileActionButton mobileDangerAction"
                type="button"
                disabled={isClearBusy}
                onClick={() => void confirmClearSession()}
              >
                {isClearBusy ? <RefreshCw size={16} className="mobileSpin" /> : <Trash2 size={16} />}
                <span>
                  {isClearBusy
                    ? t("settings.clearSession.clearing")
                    : clearSheetStatusKey === "settings.status.nativeBridgeUnavailable"
                      ? t("settings.clearSession.retry")
                      : t("settings.clearSession.confirm")}
                </span>
              </button>
            </>
          )}
        >
            <div className="mobileSheetMetaGrid">
              <div>
                <span>{t("settings.clearSession.storage")}</span>
                <strong>{t("settings.clearSession.storageValue")}</strong>
              </div>
              <div>
                <span>{t("settings.clearSession.effect")}</span>
                <strong>{t("settings.clearSession.effectValue")}</strong>
              </div>
            </div>
            <StatusNotice
              className="mobileSignalRow"
              icon={isClearBusy ? <RefreshCw size={14} className="mobileSpin" /> : <ShieldCheck size={14} />}
            >
              {t(clearSheetStatusKey)}
            </StatusNotice>
        </BottomSheet>
      )}
    </div>
  );
}
