// Re-export the shared notification intent SSOT so mobile consumers
// (notificationBridge, deepLinking) keep a single import path while the
// canonical schema + parser live in @agenthub/shared/notificationIntents.
//
// Metro note: `./notificationIntents` must stay in app/shared/package.json
// exports for this re-export to resolve.
export * from '@agenthub/shared/notificationIntents';
