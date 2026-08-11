// Re-export the shared notification intent SSOT so mobile consumers
// (notificationBridge, deepLinking) keep a single import path while the
// canonical schema + parser live in @agenthub/shared/notificationIntents.
//
// Metro note: requires `./notificationIntents` in app/shared/package.json
// exports — tracked in BLOCKED (shared-lane follow-up).
export * from '@agenthub/shared/notificationIntents';
