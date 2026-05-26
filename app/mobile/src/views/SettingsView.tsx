export function SettingsView() {
  return (
    <div className="flex flex-col h-full">
      <header
        className="glass shrink-0 flex items-center px-4"
        style={{
          height: "calc(56px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <h1 className="text-lg font-semibold" style={{ color: "var(--td-ink)" }}>
          Settings
        </h1>
      </header>

      <div className="flex-1 scroll-container px-3 py-3 space-y-2">
        <div
          className="rounded-lg p-4"
          style={{
            backgroundColor: "var(--td-surface)",
            border: "1px solid var(--td-line)",
          }}
        >
          <h3 className="text-sm font-medium" style={{ color: "var(--td-ink)" }}>
            Account
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--td-ink-50)" }}>
            TokenDance ID login — coming soon
          </p>
        </div>

        <div
          className="rounded-lg p-4"
          style={{
            backgroundColor: "var(--td-surface)",
            border: "1px solid var(--td-line)",
          }}
        >
          <h3 className="text-sm font-medium" style={{ color: "var(--td-ink)" }}>
            Notifications
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--td-ink-50)" }}>
            Push notifications via FCM — coming soon
          </p>
        </div>

        <div
          className="rounded-lg p-4"
          style={{
            backgroundColor: "var(--td-surface)",
            border: "1px solid var(--td-line)",
          }}
        >
          <h3 className="text-sm font-medium" style={{ color: "var(--td-ink)" }}>
            About
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--td-ink-50)" }}>
            AgentHub Mobile v0.1.0
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--td-ink-30)" }}>
            Built on Tauri 2 + React 19 + TokenDance Design System
          </p>
        </div>
      </div>
    </div>
  );
}
