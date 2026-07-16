# hubClient SSOT Slice1

最后更新：2026-07-16  
Issue: #430 (T3.1)  
SSOT target: `app/shared/src/hubClient.ts`  
Surface forks (transitional): `app/desktop/src/api/hubClient.ts`, `app/web/src/api/hubClient.ts`  
Good pattern: `app/mobile-rn/src/api/hubClient.ts` (re-export/extend shared)

## Goal (this slice only)

1. Freeze desktop/web forks: **no new Hub methods/DTOs** on surface files.  
2. Expand shared **compatibility aliases** for historical desktop/web type names.  
3. Publish a **method matrix** and machine-readable gap list (`HUBCLIENT_SSOT_GAPS`).  
4. **Do not** switch all callers or delete surface implementations (that is T3.2–T3.4).

## Counts (createHubClient return keys)

| Surface | Methods | Notes |
|---|---:|---|
| shared | 79 | SSOT kernel + auth/session/message/workspace/agent-task core |
| desktop | 109 | fullest fork |
| web | 101 | near-duplicate of desktop |
| desktop ∩ web | 98 | parity target for T3.2 |
| shared ∩ desktop ∩ web | 68 | already shared |

## Gaps: desktop∩web but NOT shared (T3.2 backlog)

These methods must be added to shared before cutover:

- Team: `listAgentTeams`, `createAgentTeam`, `getAgentTeam`, `updateAgentTeam`, `deleteAgentTeam`, `addAgentTeamMember`, `listTeamRuns`, `startTeamRun`, `getTeamRun`, `getTeamRunState`, `listTeamTasks`, `listTeamEvents`, `decideTeamApproval`, `resolveTeamConflict`
- Profiles: `listAgentProfiles`, `createAgentProfile`, `updateAgentProfile`, `deleteAgentProfile`
- Task events: `listTaskRunEvents`, `listTaskRunEventsAfter`, `getTaskRunEventSummary`
- Settings: `fetchSettings`, `patchSettings`
- Attachments: `uploadAttachment`, `probeAttachment`, `downloadAttachmentUrl`
- Message extras: `editMessage`, `addMessageReaction`, `removeMessageReaction`, `listMessageReactions`

Source of truth constant: `HUBCLIENT_SSOT_GAPS.desktopAndWebNotShared` in shared hubClient.

## Surface-only (keep local until product decision)

| Owner | Methods |
|---|---|
| Desktop only | `createDocument`, `updateDocument`, `deleteDocument`, `listDocuments`, `getDocument`, `createExecutionTarget`, `updateExecutionTarget`, `getAgentProfile`, `removeAgentTeamMember`, `postTeamRouteDecision`, `streamTaskEvent` |
| Web only | `listTaskApprovals`, `decideTaskApproval`, `listTaskArtifacts` |

## Type aliases added/confirmed on shared

Historical desktop/web names → shared `Hub*` types, including:

`Session`→`HubSession`, `AuthResponse`→`HubAuthResponse`, `UserProfile`, `Device`, `MessageResponse`, `MessageAttachment`, `CustomAgent`, `Notification`, `ExecutionTarget`, `WorkspaceProject*`, `AgentTask`, `OIDC*`, `Skill`, `MCPServer`, …

Prefer **Hub\*** names in new shared code. Aliases exist so T3.3/T3.4 re-exports do not require a big-bang rename.

## Freeze comments

- `app/desktop/src/api/hubClient.ts` header: no new methods  
- `app/web/src/api/hubClient.ts` header: no new methods + AH-SR-043 note  

## Tests

- Existing `app/shared/src/hubClient.test.ts` still covers envelope helpers.  
- Slice1 adds export-surface assertion for aliases + `HUBCLIENT_SSOT_GAPS` shape.

## Next slices

| Issue | Work |
|---|---|
| #431 T3.2 | Implement gap methods on shared + contract tests |
| #432 T3.3 | Desktop thin re-export cutover |
| #433 T3.4 | Web thin re-export + AH-SR-043 fail-closed |

## Non-goals (explicit)

- No mass caller rewrite  
- No auth storage changes  
- No Web Local Edge  
- No deletion of desktop/web hubClient files yet  
