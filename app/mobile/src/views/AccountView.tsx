import { useState } from "react";
import { getSurfaceStatusMetadata, getSurfacesByPlatform } from "@agenthub/shared";
import { Bell, Languages, Link2, LogIn, RefreshCw, ShieldCheck, Smartphone, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { mobileLanguages, type MobileLanguage } from "../i18n";
import {
  clearHubAccessToken,
  readHubAccessToken,
  sendMobileNotificationProbe,
  startMobileOidcLogin,
} from "../native/mobileCommands";

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

export function AccountView() {
  const { t, i18n } = useTranslation();
  const [statusKey, setStatusKey] = useState<NativeStatusKey>("settings.status.idle");
  const [isBusy, setIsBusy] = useState(false);
  const [clearSheetOpen, setClearSheetOpen] = useState(false);
  const [clearSheetStatusKey, setClearSheetStatusKey] = useState<NativeStatusKey>("settings.status.idle");
  const [isClearBusy, setIsClearBusy] = useState(false);
  const currentLanguage: MobileLanguage = i18n.language?.startsWith("zh") ? "zh" : "en";
  const mobileSurfaces = getSurfacesByPlatform("mobile");
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

  async function runNativeAction(action: () => Promise<NativeStatusKey>, pendingKey: NativeStatusKey) {
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
          <section className="mobileSettingCard">
            <h3>{t("settings.account.title")}</h3>
            <p>{t("settings.account.description")}</p>
            <div className="mobileSettingActions">
              <button
                className="mobileActionButton"
                type="button"
                disabled={isBusy}
                onClick={() => void runNativeAction(async () => {
                  await startMobileOidcLogin();
                  return "settings.status.loginStarted";
                }, "settings.status.startingLogin")}
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
                }, "settings.status.checkingSession")}
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
                <div className="mobileReadinessRow" key={item.title}>
                  <span className="mobileReadinessIcon">{item.icon}</span>
                  <span className="mobileReadinessBody">
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </span>
                  <span className="mobileReadinessState">{item.state}</span>
                </div>
              ))}
            </div>
            <div className="mobileSignalRow" role="status" aria-live="polite">
              {isBusy ? <RefreshCw size={14} className="mobileSpin" /> : <ShieldCheck size={14} />}
              <span>{t(statusKey)}</span>
            </div>
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
                  <div className="mobileSurfaceRegistryRow" key={surface.id}>
                    <span className="mobileSurfaceRegistryBody">
                      <strong>{t(surface.labelKey)}</strong>
                      <span>{t(surface.descriptionKey)}</span>
                    </span>
                    <span className="mobileSurfaceRegistryState">
                      {t(status.labelKey)}
                    </span>
                  </div>
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
            <div className="mobileSegmentedToolbar mobileLanguageToolbar" aria-label={t("settings.language.title")}>
              {mobileLanguages.map((language) => {
                const isActive = currentLanguage === language.code;
                return (
                  <button
                    key={language.code}
                    className={`mobileSegmentButton${isActive ? " mobileSegmentButtonActive" : ""}`}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => void i18n.changeLanguage(language.code)}
                  >
                    <Languages size={14} />
                    <span>{language.code === "zh" ? t("settings.language.chinese") : t("settings.language.english")}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mobileSettingCard">
            <h3>{t("settings.notifications.title")}</h3>
            <p>{t("settings.notifications.description")}</p>
            <button
              className="mobileActionButton"
              type="button"
              disabled={isBusy}
              onClick={() => void runNativeAction(async () => {
                const granted = await sendMobileNotificationProbe();
                return granted ? "settings.status.notificationSent" : "settings.status.notificationDenied";
              }, "settings.status.requestingNotifications")}
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
        <div className="mobileSheetLayer" role="presentation">
          <button
            className="mobileSheetScrim"
            type="button"
            aria-label={t("settings.clearSession.close")}
            onClick={() => {
              if (!isClearBusy) {
                setClearSheetOpen(false);
              }
            }}
          />
          <section
            className="mobileBottomSheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("settings.clearSession.aria")}
          >
            <div className="mobileSheetHandle" aria-hidden="true" />
            <div className="mobileSheetHeader">
              <div>
                <p className="mobileEyebrow">{t("settings.clearSession.eyebrow")}</p>
                <h2>{t("settings.clearSession.title")}</h2>
              </div>
              <button
                className="mobileIconButton"
                type="button"
                disabled={isClearBusy}
                aria-label={t("settings.clearSession.close")}
                onClick={() => setClearSheetOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="mobileSheetDescription">{t("settings.clearSession.description")}</p>
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
            <div className="mobileSignalRow" role="status" aria-live="polite">
              {isClearBusy ? <RefreshCw size={14} className="mobileSpin" /> : <ShieldCheck size={14} />}
              <span>{t(clearSheetStatusKey)}</span>
            </div>
            <div className="mobileSheetActions">
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
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
