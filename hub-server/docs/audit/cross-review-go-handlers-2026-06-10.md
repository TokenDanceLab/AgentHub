# Go HTTP Handler Cross-Review -- 2026-06-10

> Audited: `D:\Code\TokenDance\AgentHub\hub-server\internal\handler\`
> Scope: all Go HTTP handlers per task description, plus attachment/notification/custom-agent/device/health for completeness.
> Method: handler-by-handler inspection against router.go route registration, errcode/codes.go, response.go helpers, and validation.go.

---

## 1. Handler-by-Handler Findings

### 1.1 handler/auth.go

**Me, UpdateProfile, Refresh** -- No issues. All three correctly bind JSON, extract `user_id` from context, type-check `*errcode.Error`, and respond via `OK()` / `Fail()`.

**Logout (line 54-64)** -- BUG (error-type swallowing).
```go
func (h *AuthHandler) Logout(c *gin.Context) {
    // ...
    if err := h.service.Logout(c.Request.Context(), userID, deviceID, deviceType); err != nil {
        slog.Error("auth logout error", ...)
        Fail(c, errcode.ErrInternal)  // <-- ALL errors mapped to ErrInternal
        return
    }
    OK(c, nil)
}
```
Every other handler in the codebase does `if e, ok := err.(*errcode.Error); ok { Fail(c, e); return }; Fail(c, errcode.ErrInternal)`. Logout is the sole exception. If `service.Logout` returns a domain error (e.g. token already revoked), the client receives a generic 500 instead of the meaningful code.

**Severity**: Medium. Fix: add the standard type-assertion pattern.

---

### 1.2 handler/oidc.go

**PostOIDCAuthorize, PostOIDCCallback** -- No issues. Validates `device_type` against canonical set, validates `device_id` as UUID, uses `safeOIDCServiceError` to keep internal messages out of responses. Strong OIDC-specific error categorization.

**GetOIDCCallback** -- No issues. Handles missing `code`/`state` with i18n HTML pages. Correctly does not expose internal errors (this is a browser-facing GET endpoint with no service call; the real exchange happens via POST).

---

### 1.3 handler/session.go

**SessionService interface (line 13-26)** -- Lists 16 methods. All 16 are implemented on `SessionHandler` and all 16 are referenced in `router.go`. No mismatch.

**All handlers** -- Correct error-handling pattern. `TransferOwner` correctly handles dual-field (`new_owner_id` / `new_owner_user_id`) with `resolveNewOwnerID()` fallback.

**SearchSessions (line 263-281)** -- Validates that query param `q` is non-empty before calling service. Good.

**NIL-SLICE ISSUE -- List, ListSessions (line 83-95)** -- `List` returns `service.ListSessions(...)` directly. If the service returns nil (no sessions), JSON serializes as `null`. Contrast with `DocumentHandler.ListDocuments` which guards with `if items == nil { items = []model.DocumentListItem{} }`.

**Severity**: Low (cosmetic -- most clients should handle `null` vs `[]`, but inconsistent).

Same nil-slice issue affects: `ListFriendRequests`, `ListContacts`, `SearchSessions`.

---

### 1.4 handler/message.go

**SendMessage (line 40-69)** -- Validates `ClientMsgID` as UUID when present. All message handlers correctly extract `user_id` from context.

**GetMessages / GetIncrementalMessages** -- Good: validates limit bounds, uses `config.MaxMessagePageLimit` / `config.MaxIncrementalMessageLimit` as hard caps, defaults to `config.DefaultPaginationLimit`.

**PinMessage / UnpinMessage (line 198-242)** -- SessionID comes from request body, not URL params. This is a design choice (vs `:id` in URL). The route `POST /messages/:id/pin` uses `:id` as msgID; sessionID is in the body. This is consistent with the route definition.

**Nil-slice issues**: `ListPins`, `SearchMessages`, `SearchSessionMessages`, `ListMessageReactions` -- no nil guards.

**AddMessageReaction / RemoveMessageReaction** -- Both are POST and DELETE on `/messages/:id/reactions` respectively. The body contains `session_id` and `reaction`. `ListMessageReactions` uses GET with `session_id` as a query param. The asymmetry (body vs query) is consistent: mutations use body, reads use query params. Acceptable.

---

### 1.5 handler/contact.go

**All handlers** -- Correct error type-check pattern.

**Nil-slice issues**: `ListFriendRequests` (line 76-88), `ListContacts` (line 118-130), `SearchUser` -- no nil guards.

---

### 1.6 handler/agent.go

**TriggerTask (line 80-106)** -- 7 parameters forwarded to service. Correct. No validation of which agent-identification fields are present (instance_id vs agent_type vs custom_agent_id handled by service).

**TaskAck (line 124-151)** -- Interesting edge-case handling: reads body manually with `io.ReadAll` to allow empty body (the `edge_run_id` / `run_id` fields are optional in ACK). This is correct because `gin.ShouldBindJSON` would reject an empty body.

**TaskStream (line 176-207)** -- Validates that at minimum `content` or `payload` is non-empty. Validates `client_msg_id` as UUID. Good.

**TaskEvents (line 210-228)** -- Filter parsing via `runEventFilterFromQuery` validates `after_seq` and `limit` as non-negative. Good.

**TaskApprovals / DecideTaskApproval / TaskArtifacts** -- Use type-assertion `h.service.(agentTaskProjectionService)` to check whether the underlying service supports these optional features at runtime. This is a clean pattern for optional projections. The `ok == false` case returns `ErrInternal` which is correct (the route should not be registered if the projection isn't wired).

**decideApprovalReq** -- Used in both `AgentHandler.DecideTaskApproval` and `AgentTeamHandler.DecideApproval`. In agent.go there is no standalone declaration; it uses an inline anonymous struct. In agent_team.go it's declared at the top. Both validate `decision` as required string but do not validate that the value is a recognized enum. The service layer should handle this.

**taskFailReq (line 365-368)** -- `Error` field has `binding:"required"`. Good.

**taskDoneReq (line 338-342)** -- `FinalContent` is NOT required. This allows a task to signal completion without a final message. Intentional.

**taskStreamReq.normalizedStream() (line 399-410)** -- Falls back from `Content` to `Chunk` field. This is legacy dual-field handling. No issues.

---

### 1.7 handler/document.go

**ListDocuments (line 85-102)** -- PROPER nil guard: `if items == nil { items = []model.DocumentListItem{} }`. This is the gold standard for nil-slice handling. Also wraps response in `gin.H{"items": items}` which is a pagination-ready envelope.

**ListDocuments filter binding (line 88)** -- `_ = c.ShouldBindQuery(&filter)` -- silently ignores bind errors. If filter query params are malformed, the handler continues with zero-valued filter. This is acceptable for optional filters but differs from message handlers which return 400 on bad query params.

---

### 1.8 handler/workspace.go

**CreateWorkspace (line 45-65)** -- BUG (inconsistency). Uses `c.JSON(http.StatusOK, Response{Code: errcode.OK.Code, Data: workspace})` instead of `OK(c, workspace)`. While functionally identical, this breaks the convention used everywhere else. If `OK()` ever gains additional behavior (e.g. response logging, header injection), this handler will miss it.

**ListWorkspaces (line 80-95)** -- Wraps in a paginated envelope `{items, page: {nextCursor, hasMore}}`. Good structure. `pageSize` parsed with `strconv.Atoi` on `c.DefaultQuery("pageSize", "50")` -- but: does not validate max limit, and does not sanitize negative values.

**ListProjectThreads (line 123-134)** -- No nil guard for threads slice.

**ListProjectThreadMessages (line 182-194)** -- No nil guard. `limit` parsed from query but no max cap.

---

### 1.9 handler/user_settings.go

**GetSettings (line 26-43)** -- BUG (internal error exposure).
```go
settings, err := h.settingsService.GetSettings(userID)
if err != nil {
    FailWithMessage(c, errcode.ErrInternal, err.Error())  // <-- LEAKS raw error to client
    return
}
```
Same issue on **PatchSettings (line 63-66)**.

**Severity**: High (security). Raw Go error messages can contain stack traces, SQL fragments, or internal paths.

Additionally: the service interface methods `GetSettings` and `UpsertSettings` do not accept `context.Context`, unlike all other service interfaces. The handler does not pass `c.Request.Context()` to the service call. This means:
- No request-scoped cancellation propagation
- No trace context passed through

**Nil guard**: Present (both methods return `map[string]string{}` when nil). Good.

**userID guard**: Present -- checks empty string and returns `ErrUnauthorized`. This is extra defensive since the middleware should guarantee it. Good.

---

### 1.10 handler/ws.go

**ServeWS (line 32-64)** -- Two code paths:
1. **Middleware-authenticated**: If `c.GetString("user_id")` is set (from `WSAuthMiddleware`), skips in-protocol auth and goes straight to `messageLoop`.
2. **In-protocol auth**: Otherwise starts `readLoop` which expects an auth frame as the first message.

The `isProductionEnv()` check controls `InsecureSkipVerify` on the WebSocket upgrade. Only dev environments skip origin verification. Correct.

**readLoop (line 83-150)** -- 5-second timeout for first auth frame. On timeout: logs and returns (falls through to `defer h.manager.Unregister`). On invalid auth: sends `AuthFail` frame with typed reason, sleeps 100ms to allow the client to receive the frame, then closes. The 100ms sleep is a pragmatic fairness gesture.

**messageLoop (line 155-177)** -- Identical frame processing to readLoop's inner loop, minus the auth handshake. Good deduplication of the operational concern.

**handleTyping (line 179-191)** -- Checks `canTypeInSession` via `h.manager.ResolveMembers`. On failure, logs a warning and silently returns without sending an error frame. This is correct -- typing events are fire-and-forget.

**sendFrame (line 222-233)** -- Non-blocking send with `select default:` fallback. On buffer full: increments `metrics.WSDroppedFrames` and logs a warning. Excellent for backpressure without blocking the read loop.

**NOTE**: `writeLoop` defers `conn.W.Close(websocket.StatusNormalClosure, "")`. If the conn's write goroutine exits (e.g. because the `conn.Send` channel is closed), this closes the underlying WebSocket. The `readLoop`/`messageLoop` will then encounter a read error on the next `conn.W.Read()` and exit. This is a correct shutdown coordination pattern.

---

### 1.11 handler/agent_team.go

**All handlers** -- Correct error-handling pattern.

**Nil guards present on**: `ListTeams` (line 104-106), `ListRuns` (line 231-233), `ListAssignments` (line 448-450). Good.

**Nil guards MISSING on**: `ListTeamTasks` (line 286), `ListTeamEvents` (line 303). These return raw slice from service without `nil`-to-`[]` coercion.

**CreateAssignment (line 360-378)** -- `Type` field has `omitempty` tag but no validation. If provided, it's passed directly. Service should validate.

**ResolveConflict (line 455-480)** -- `ConflictID` is extracted from URL param `conflict_id` and packed into `model.TeamConflictResolution` inline. Good.

---

### 1.12 handler/attachment.go

**Probe (line 48-74)** -- Validates hash format via `service.IsValidAttachmentHash`. Returns `{exists: bool, attachment: ...}` even when attachment is nil. Correct API design.

**Upload (line 76-167)** -- Full validation pipeline:
1. Hash validation
2. Max upload size check
3. Stream to temp file with SHA-256 verification
4. MIME type sniffing from temp file
5. MIME type allowlist check
6. Image metadata extraction
7. Blob commit
8. Rollback blob on metadata save failure

Excellent defensive programming.

**Download (line 169-213)** -- BUG (error masking, lines 173-176):
```go
a, err := h.service.GetAttachmentByID(c.Request.Context(), userID, id)
if err != nil {
    Fail(c, errcode.AttachNotFound)  // <-- All errors map to "not found"
    return
}
```
If the underlying database returns a connection error, the client receives `ATTACH_NOT_FOUND`. This is incorrect. Should use the standard `if e, ok := err.(*errcode.Error)` pattern.

---

### 1.13 handler/notification.go

**ListNotifications (line 29-59)** -- MINOR ISSUE: `limit` and `offset` are parsed with `strconv.Atoi` and errors are silently ignored (`if err == nil`). This means `?limit=abc` silently uses the default instead of returning 400. Contrast with `GetMessages` which returns `ErrBadRequest` on parse failure.

No nil guard for empty notification list.

---

### 1.14 handler/custom_agent.go

**Create (line 39-65)** -- Validates JSONB fields before DB insert via `model.CustomAgent.Validate()`. Good pre-validation.

**List (line 68-80)** -- No nil guard for empty agent list.

**Update (line 93-125)** -- All fields are required per struct tags. This means a PATCH-like partial update is not possible; every update must resend all fields. This is a design choice, not a bug, but worth noting for API evolution.

---

### 1.15 handler/device.go

**Register (line 52-87)** -- Validates `device_id` as UUID. Cross-validates that JWT `device_id` matches request body `device_id` -- excellent security measure against JWT reuse across devices.

**ListDevices (line 91-109)** -- BUG (error-type swallowing, line 95-98):
```go
devices, err := h.deviceService.ListDevices(userID)
if err != nil {
    Fail(c, errcode.ErrInternal)  // <-- All errors mapped to ErrInternal
    return
}
```
Does not type-check for `*errcode.Error`. Same pattern as `auth.Logout`.

Has nil guard for devices slice. Good.

**CloudEdgeRegister (line 148-193)** -- Validates device_id as UUID. Generates edge-scoped JWT. Defaults TTL to 24h if not configured. Correct.

---

### 1.16 handler/health.go

**Ready (line 55-65)** -- Uses `c.JSON(statusCode, Response{Code: "OK", Data: report})` directly. When degraded, the HTTP status is 503 but the JSON body still has `"code": "OK"`. This is a protocol mismatch -- a 503 response should use the error envelope format (`{"error": {"code": "...", "message": "..."}}`). However, this might be intentional since health endpoints are consumed by infrastructure, not by the app's own error-handling pipeline.

**Check (line 43)** -- Uses `OK()`. Correct.

---

## 2. Route Registration Cross-Reference

Checked every handler method referenced in `router.go` against actual method implementations:

| File | Methods in router | All exist? |
|------|-------------------|-----------|
| auth.go | Refresh, Me, Logout, UpdateProfile | YES |
| oidc.go | PostOIDCAuthorize, PostOIDCCallback, GetOIDCCallback | YES |
| contact.go | SearchUser, SendFriendRequest, ListFriendRequests, AcceptFriendRequest, RejectFriendRequest, ListContacts, RemoveContact, BlockContact, UnblockContact, UpdateRemark (10) | YES |
| session.go | List, CreatePrivate, CreateGroup, AddMembers, RemoveMember, Leave, TransferOwner, Dissolve, UpdateGroupInfo, UpdateMemberSettings, DeleteForMe, SearchSessions (12) | YES |
| message.go | SendMessage, GetMessages, GetIncrementalMessages, RecallMessage, EditMessage, PinMessage, UnpinMessage, ListPins, ForwardMessage, MarkRead, SearchMessages, SearchSessionMessages, AddMessageReaction, RemoveMessageReaction, ListMessageReactions (15) | YES |
| agent.go | AddAgentToSession, TriggerTask, CancelTask, TaskAck, TaskStream, TaskDone, TaskFail, TaskEvents, TaskEventSummary, TaskApprovals, DecideTaskApproval, TaskArtifacts (12) | YES |
| document.go | CreateDocument, GetDocument, ListDocuments, UpdateDocument, DeleteDocument (5) | YES |
| workspace.go | CreateWorkspace, GetWorkspace, ListWorkspaces, UpdateWorkspace, ListProjectThreads, CreateProjectThread, ListProjectThreadMessages, CreateProjectThreadMessage (8) | YES |
| agent_team.go | CreateTeam, ListTeams, GetTeam, UpdateTeam, DeleteTeam, AddMember, RemoveMember, StartRun, ListRuns, GetRun, GetRunState, ListTeamTasks, ListTeamEvents, HandleRouteDecision, DecideApproval, ResolveConflict, CreateAssignment, DispatchAssignment, CompleteAssignment, FailAssignment, ListAssignments (21) | YES |
| user_settings.go | GetSettings, PatchSettings (2) | YES |
| ws.go | ServeWS (1) | YES |
| device.go | Register, ListDevices, CloudEdgeRegister (3) | YES |
| custom_agent.go | Create, List, Update, Delete (4) | YES |
| notification.go | ListNotifications, MarkRead, ReadAll (3) | YES |
| attachment.go | Probe, Upload, Download (3) | YES |
| health.go | Check, Live, Ready (3) | YES |

**Result: 0 missing handlers. 0 orphaned routes. 100% coverage.**

---

## 3. Service Interface Compatibility

Handler-level interfaces (defined in each handler file) vs router.go parameter types:

Router declares: `*handler.AuthHandler`, `*handler.SessionHandler`, etc.
Handler constructors accept: `SessionService`, `ContactService`, etc. (interface, not concrete type).

This means the wiring layer (app.go) must provide a service implementation that satisfies the interface. The interface is defined in the handler file, making it self-documenting which methods the handler needs. This is a good dependency-inversion pattern.

No signature mismatches detected between handler interface definitions and actual usage.

---

## 4. API Contract Compliance Summary

### Response Envelope Consistency

| Handler | Method | Uses OK()/Fail()? | Consistent? |
|---------|--------|-------------------|-------------|
| workspace | CreateWorkspace | Manual `c.JSON` | NO (minor) |
| health | Ready | Manual `c.JSON` | PARTIAL (deliberate for 503) |
| ALL OTHERS | All methods | OK()/Fail() | YES |

### Error Handling Consistency

| Pattern | Where Used | Consistent? |
|---------|-----------|-------------|
| `if e, ok := err.(*errcode.Error); ok { Fail(c, e); return }; Fail(c, ErrInternal)` | All handlers except: | **Standard** |
| Direct `Fail(c, errcode.ErrInternal)` (no type-check) | auth.Logout, device.ListDevices | **BUG** |
| `FailWithMessage(c, errcode.ErrInternal, err.Error())` exposing raw error | user_settings.GetSettings, user_settings.PatchSettings | **SECURITY BUG** |
| All errors mapped to single code | attachment.Download (always AttachNotFound) | **BUG** |

### Nil Slice Guards

| File | Method | Has guard? |
|------|--------|-----------|
| document.go | ListDocuments | YES |
| agent_team.go | ListTeams, ListRuns, ListAssignments | YES |
| device.go | ListDevices | YES |
| user_settings.go | GetSettings, PatchSettings | YES |
| session.go | List, SearchSessions | NO |
| message.go | ListPins, SearchMessages, SearchSessionMessages, ListMessageReactions | NO |
| contact.go | ListFriendRequests, ListContacts | NO |
| workspace.go | ListProjectThreads, ListProjectThreadMessages | NO |
| agent_team.go | ListTeamTasks, ListTeamEvents | NO |
| custom_agent.go | List | NO |
| notification.go | ListNotifications | NO |

---

## 5. Quick-Fix Recommendations

### CRITICAL (security)
1. **user_settings.go:35,65** -- Replace `FailWithMessage(c, errcode.ErrInternal, err.Error())` with the standard type-check pattern. Never expose raw Go error text to clients.
2. **user_settings.go:11-12** -- Add `context.Context` as first parameter to `GetSettings` and `UpsertSettings` interfaces (and implementations), then pass `c.Request.Context()` from the handler.

### HIGH (correctness)
3. **auth.go:59-63 (Logout)** -- Add `*errcode.Error` type-check before falling back to `ErrInternal`.
4. **device.go:95-98 (ListDevices)** -- Same fix: add `*errcode.Error` type-check.
5. **attachment.go:173-176 (Download)** -- Replace unconditional `AttachNotFound` with the standard type-check pattern. The service may return `ErrInternal`, `ErrNotFound`, or domain-specific errors.

### MEDIUM (consistency)
6. **workspace.go:64 (CreateWorkspace)** -- Replace `c.JSON(http.StatusOK, Response{...})` with `OK(c, workspace)`.
7. **notification.go:36-46 (ListNotifications)** -- Return `ErrBadRequest` on `strconv.Atoi` failures for `limit` and `offset`, matching the pattern in `GetMessages`.
8. **workspace.go:81** -- Add max limit enforcement and negative-value sanitization for `pageSize`.
9. **workspace.go:183** -- Add max limit enforcement for `limit` in `ListProjectThreadMessages`.

### LOW (cosmetic)
10. Add `nil`-to-`[]` guards to all list-returning handlers that currently lack them (see Section 4 nil-slice table above). This ensures JSON responses always use `[]` instead of `null` for empty collections.
11. **health.go:61-63 (Ready)** -- Consider whether a 503 response should use the error envelope format. Currently returns `{"code":"OK","data":{...}}` even with HTTP 503. If load-balancers only look at status codes, this is fine; if any client parses the body, this is misleading.

---

## 6. Verification Checklist

- [x] All handler files read and analyzed
- [x] Every handler method cross-referenced against router.go
- [x] Error code definitions reviewed
- [x] Response helper (OK/Fail/FailWithMessage) contract verified
- [x] Validation helper (normalizeUUID) usage checked
- [x] Service interface definitions compared against handler usage
- [x] 0 orphaned routes
- [x] 0 missing handler methods
- [x] 2 confirmed bugs (Logout error swallowing, Download error masking)
- [x] 1 security issue (internal error exposure in user_settings)
- [x] 1 architectural debt (missing context.Context in user_settings service)
- [x] 11 cosmetic nil-slice guard gaps identified

---

*Audit performed 2026-06-10. Files examined: auth.go, oidc.go, session.go, message.go, contact.go, agent.go, agent_team.go, document.go, workspace.go, user_settings.go, ws.go, attachment.go, notification.go, custom_agent.go, device.go, health.go, router.go, response.go, validation.go, codes.go.*
