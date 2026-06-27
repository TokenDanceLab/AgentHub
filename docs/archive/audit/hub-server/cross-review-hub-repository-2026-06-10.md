# Cross-Review: Hub Repository Layer

**Date:** 2026-06-10
**Scope:** `internal/repository/` (21 files), migrations 0001-0049, service-layer callers

---

## 1. SQL Injection Audit

**Verdict: No SQL injection risk found.**

All queries use Gorm's parameterized placeholders (`?`, `IN ?`). Raw SQL strings are limited to:

| File | Function | Pattern | Risk |
|------|----------|---------|------|
| `message.go` | `AllocateSeqID` | `tx.Raw("UPDATE ... WHERE id = ?", sessionID)` | Safe |
| `message.go` | `SearchAllMessages` | Dynamic WHERE appended via `+` but values are `args...` | Safe |
| `message.go` | `messageSearchCondition` | Builds SQL fragment from static table alias; `q` is parameterized | Safe |
| `session.go` | `FindPrivateSessionBetween` | `db.Raw(sql, userA, userB, ...)` | Safe |
| `session.go` | `SearchSessions`, `ListUserSessions`, `ListWorkspaceSessions` | `db.Raw(sql, userID, ...)` | Safe |
| `message_attachment.go` | `CanUserAccessReferencedAttachment` | `db.Raw(sql, ...)` with const SQL | Safe |
| `migrate.go` | `runMigrations` | `fmt.Sprintf` for DSN construction only (no user input in SQL) | Safe |

The `SearchSessions` LIKE pattern `"%" + q + "%"` is NOT escaped for ILIKE wildcards, but this is a minor information-leak concern (wildcard injection), not a SQL injection. The `message.go` file properly escapes ILIKE wildcards with `escapeILIKE()`.

---

## 2. N+1 Query Inventory

| # | File/Caller | Pattern | Severity | Fix |
|---|-------------|---------|----------|-----|
| N1 | `user_settings.go` `UpsertSettings` | Loops over `values` map, executing one `Create` per key | Medium | Batch all settings into a single `Clauses(OnConflict{...}).Create([]settings)` call |
| N2 | `session.go` `cleanupInvitedAgents` | Loops over agents: `CancelTasksByAgentInstance` + `DeleteAgentInstance` + `SoftDeleteMember` per agent | Medium | These are writes, not reads; acceptable at typical agent-per-session scale (<10). No fix needed unless agent count grows. |
| N3 | `session.go` `AddGroupMembers` | Loops `memberIDs`: `IsMemberActive` per member, then `IsMemberSoftDeleted` + `ReactivateMember` per member | Medium | Batch `IsMemberActive` into a single `WHERE session_id=? AND member_type=? AND member_id IN (?)` query; same for `IsMemberSoftDeleted`. |
| N4 | `agent.go` `CreateAgentRunEventWithNextSeqLimited` | Within transaction: `SELECT ... FOR UPDATE` + `SELECT MAX(seq)` + `INSERT` (3 queries per event) | Low | Acceptable; sequential event insertion is inherently serial. The transaction + FOR UPDATE lock is correct. |
| N5 | `agent_team.go` `countMatchingRouteDecisions` | Fetches ALL team events and filters in Go | Medium | Add a dedicated query: `SELECT COUNT(*) FROM agent_team_events WHERE team_run_id=? AND type='route_decided'` with JSON predicate filtering, or accept current approach if event volume is low. |
| N6 | `agent_team.go` `hasTimedOutActiveAssignment` | Fetches ALL assignments and filters in Go | Low | Add: `SELECT 1 FROM agent_team_assignments WHERE team_run_id=? AND status IN (...) AND created_at < ? LIMIT 1` |
| N7 | `agent_team.go` `teamRunBudgetExceeded` | Fetches assignments, tasks, and ALL run events; processes in Go | Medium | This is a read-heavy aggregation. Consider a SQL-based token summary or accept the current approach if team runs are infrequent. |

The service layer (`contact.go`, `message.go`) already uses batch queries for user lookups (`GetUsersByIDs`), reply-to messages (`GetMessagesByIDs`), and attachments (`ListAttachmentsByMessageIDs`). This is well done.

---

## 3. Missing Index Report

### 3.1 Confirmed Missing Indexes

| # | Table | Query Pattern | Affected Functions | Missing Index | Recommendation |
|---|-------|---------------|--------------------|---------------|----------------|
| M1 | `custom_agents` | `WHERE owner_user_id = ?` | `ListCustomAgentsByOwner` | No index on `owner_user_id` | `CREATE INDEX idx_custom_agents_owner ON custom_agents(owner_user_id) WHERE deleted_at IS NULL;` |
| M2 | `custom_agents` | `WHERE id = ? AND deleted_at IS NULL` | `GetCustomAgentByID` | PK scan + filter; acceptable but partial index would help soft-delete filter | `CREATE INDEX idx_custom_agents_id_active ON custom_agents(id) WHERE deleted_at IS NULL;` (optional, PK is already fast) |
| M3 | `agent_teams` | `WHERE owner_id = ?` | `ListTeamsByOwner` | No index on `owner_id` | `CREATE INDEX idx_agent_teams_owner ON agent_teams(owner_id);` |
| M4 | `agent_team_members` | `WHERE team_id = ?` | `ListTeamMembers` | No index on `team_id` | `CREATE INDEX idx_agent_team_members_team ON agent_team_members(team_id);` |
| M5 | `agent_team_members` | `JOIN ... ON agent_profile_id = custom_agents.id` | `ListTeamsReadableByUser`, `TeamHasAgentOwnedByUser` | No index on `agent_profile_id` | `CREATE INDEX idx_agent_team_members_profile ON agent_team_members(agent_profile_id) WHERE agent_profile_id IS NOT NULL;` |
| M6 | `agent_team_runs` | `WHERE session_id = ? ORDER BY created_at DESC` | `GetTeamRunBySessionID` | No index on `session_id` | `CREATE INDEX idx_agent_team_runs_session ON agent_team_runs(session_id);` |
| M7 | `agent_team_runs` | `WHERE team_id = ? ORDER BY created_at DESC` | `ListTeamRunsByTeam` | No index on `team_id` | `CREATE INDEX idx_agent_team_runs_team ON agent_team_runs(team_id);` |
| M8 | `agent_team_assignments` | `WHERE from_member_id = ? AND status IN (...)` | `CountActiveAssignmentsByMember` | Index on `from_member_id` exists but not composite with status | Adequate for count queries; consider composite `(from_member_id, status)` if perf issue observed |
| M9 | `agent_team_assignments` | `WHERE team_run_id = ? AND to_member_id = ? ORDER BY depth DESC` | `GetAssignmentByToMember` | No index on `(team_run_id, to_member_id)` | `CREATE INDEX idx_agent_team_assignments_run_to ON agent_team_assignments(team_run_id, to_member_id);` |
| M10 | `sessions` | `WHERE workspace_id = ?` | `ListWorkspaceSessions` | Index exists from migration 0048 | OK |
| M11 | `pending_agent_tasks` | `WHERE agent_instance_id = ? AND status IN (...)` | `CancelTasksByAgentInstance` | No index on `agent_instance_id` | `CREATE INDEX idx_pending_tasks_agent_instance ON pending_agent_tasks(agent_instance_id);` |
| M12 | `pending_agent_tasks` | `WHERE status = ? AND edge_run_id = ?` | `UpdatePendingTaskEdgeRunID` | No composite index | Low priority; uses PK + status filter |
| M13 | `workspaces` | `WHERE owner_id = ?` | `ListWorkspaces`, `FindWorkspaceByOwnerAndName` | No index on `owner_id` | `CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);` |

### 3.2 Existing Index Coverage (Good)

These tables have adequate indexes:
- `messages`: `(session_id, seq_id)`, `(session_id, client_msg_id)`, `(session_id, created_at DESC)`, GIN tsvector
- `session_members`: `(session_id, member_type, member_id) UNIQUE`, `(member_type, member_id)`
- `friendships`: `(user_id, friend_id) UNIQUE`, `(user_id, status)`
- `notifications`: `(user_id, read, created_at DESC)`
- `refresh_tokens`: `(token_hash) UNIQUE`, `(user_id, device_type, device_id)`
- `audit_events`: `(user_id, created_at DESC)`, `(event_type, created_at DESC)`, `(severity, created_at DESC)`, `(created_at DESC)`, `(prev_hash)`
- `agent_run_events`: `(task_id, event_seq)`, `(edge_run_id)`, `(session_id)`, `(agent_instance_id)`, `(event_type)`
- `agent_profiles`: `(owner_id) WHERE deleted_at IS NULL`, `(is_public) WHERE is_public=TRUE AND deleted_at IS NULL`, `(runtime_id)`
- `execution_targets`: `(owner_id) WHERE deleted_at IS NULL`, `(device_id)`
- `message_reactions`: `(session_id, message_id)`, `(user_id)`
- `message_attachments`: PK `(message_id, attachment_id)`, `(attachment_id)`, `(session_id, attachment_id)`
- `agent_team_tasks`: `(team_run_id)`, `(assignment_id)`, `(assignee_member_id)`, `(parent_task_id)`, `(status)`
- `agent_team_artifacts`: comprehensive (7 indexes)

---

## 4. Soft Delete Consistency

### 4.1 Pattern Analysis

The codebase uses **two** soft-delete approaches:

| Approach | Tables | Mechanism |
|----------|--------|-----------|
| `deleted_at` timestamp | `custom_agents`, `agent_profiles`, `execution_targets`, `mcp_servers`, `skills` | Manual `WHERE deleted_at IS NULL` in queries |
| `left_at` timestamp | `session_members` | Manual `WHERE left_at IS NULL` |
| No soft delete | `friendships`, `devices`, `messages`, `sessions`, `notifications`, `workspaces`, `agent_instances`, `agent_teams`, `agent_team_members`, `pending_agent_tasks`, `refresh_tokens` | Hard delete via `db.Delete()` |
| Boolean flag | `sessions` (`dissolved`), `messages` (`recalled`), `refresh_tokens` (`revoked`) | `WHERE dissolved = false`, `WHERE recalled = false` |

### 4.2 Inconsistencies Found

| # | File | Issue | Severity | Recommendation |
|---|------|-------|----------|----------------|
| S1 | `agent.go` `GetCustomAgentByID` | Uses manual `WHERE deleted_at IS NULL` instead of Gorm's `gorm.DeletedAt` type | Low | Consistent but manual. If models ever add `gorm.DeletedAt`, these manual filters become redundant. Document the convention. |
| S2 | `agent.go` `ListCustomAgentsByOwner` | Same manual `deleted_at IS NULL` | Low | Same as S1 |
| S3 | `agent.go` `UpdateCustomAgent` | Uses `db.Save(ca)` which will update ALL columns including potentially setting `deleted_at` if the model has it | Low | Verify `CustomAgent` model does not embed `gorm.Model`. If it does, `Save` could accidentally un-delete. |
| S4 | `agent_profile.go` `UpdateAgentProfile` | Same `db.Save(p)` concern as S3 | Low | Same recommendation |
| S5 | `session.go` `FindPrivateSessionBetween` | Does not filter `dissolved = false` on the session | Medium | If a dissolved private session exists, it could be returned as an active session. Add `AND s.dissolved = false` to the raw SQL. |
| S6 | `session.go` `ListUserSessions` / `ListWorkspaceSessions` | Correctly filter `s.dissolved = false` | OK | - |

---

## 5. Transaction Usage Analysis

### 5.1 Correctly Wrapped Operations

| Operation | File | Functions |
|-----------|------|-----------|
| Pin with limit check | `message.go` | `PinMessageAtomic` |
| Password + token revoke | `user.go` | `UpdatePasswordAndRevokeTokens` (deprecated) |
| Delete friendship pair | `friendship.go` | `DeleteFriendshipPair` |
| Session + members creation | `session.go` (service) | `CreatePrivateSession`, `CreateGroupSession` |
| Transfer ownership (2 member updates + session update) | `session_member.go` | `TransferOwnership` |
| Accept friend request (update + reciprocal upsert) | `contact.go` (service) | `AcceptFriendRequest` |
| Event creation with seq allocation | `agent.go` | `CreateAgentRunEventWithNextSeqLimited` |
| Artifact replacement | `agent_team.go` | `ReplaceTeamArtifactsForRun` |
| Team event with seq | `agent_team.go` | `AppendTeamEvent` |
| Audit hash chain | `audit.go` | `CreateAuditEvent` |
| Message + attachment + touch session | `message.go` (service) | `SendMessage` |
| Team run start (session + members + agents + message + run) | `agent_team.go` (service) | `StartTeamRun` |

### 5.2 Missing Transactions

| # | Operation | File | Risk | Recommendation |
|---|-----------|------|------|----------------|
| T1 | `FindOrCreateByTokenDanceSub` (find + create) | `user.go` | Low (unique constraint on `tokendance_sub` prevents duplicate, but error message may be confusing) | Wrap in `db.Transaction` or use `Clauses(OnConflict{DoNothing: true})` + retry for idempotency |
| T2 | `UpsertRefreshToken` (find + save) | `refresh_token.go` | Low (unique constraint on `token_hash` prevents data corruption) | Use `Clauses(OnConflict{...}).Create()` for atomic upsert instead of read-then-write |
| T3 | `AddGroupMembers` (reactivate + batch create) | `session.go` (service) | Medium (mix of ReactivateMember + BatchCreateMembers outside transaction) | Wrap the entire member-addition block in a transaction |
| T4 | `SearchSessions` raw SQL | `session.go` | N/A (read-only) | No transaction needed |

### 5.3 SkipDefaultTransaction Consideration

`db.go` sets `SkipDefaultTransaction: true`, which means Gorm will NOT wrap individual `Create`/`Update`/`Delete` calls in implicit transactions. This is a performance optimization that is correct because:
- All multi-step operations that need atomicity already use explicit `db.Transaction()`
- Single-step CRUD operations don't need transaction wrapping

---

## 6. Pagination Gap Analysis

### 6.1 Unbounded Queries (No LIMIT)

| # | Function | File | Risk |
|---|----------|------|------|
| P1 | `ListUserSessions` | `session.go` | Medium. No LIMIT. A user with thousands of sessions would return all. Hard LIMIT 20 in `SearchSessions` but none in `ListUserSessions`. |
| P2 | `ListWorkspaceSessions` | `session.go` | Same as P1. No LIMIT. |
| P3 | `ListCustomAgentsByOwner` | `agent.go` | Low. No LIMIT. Single user unlikely to have thousands of custom agents. |
| P4 | `ListAgentInstancesBySession` | `agent.go` | Low. No LIMIT. Sessions typically have <10 agent instances. |
| P5 | `ListAgentInstancesByInviter` | `agent.go` | Low. Same rationale as P4. |
| P6 | `ListAcceptedFriends` | `friendship.go` | Medium. No LIMIT. Users with many friends could cause large result sets. |
| P7 | `ListReceivedRequests` / `ListSentRequests` | `friendship.go` | Low. Pending requests are typically few. |
| P8 | `ListActiveMembers` | `session_member.go` | Low. Group sizes are bounded by social constraints. |
| P9 | `ListTeamMembers` | `agent_team.go` | Low. Team sizes are bounded. |
| P10 | `ListTeamRunsByTeam` | `agent_team.go` | Medium. No LIMIT. Could grow unbounded over time. |
| P11 | `ListTeamEventsByRun` | `agent_team.go` | Medium. No LIMIT. Event count can grow large for long-running team runs. |
| P12 | `ListTeamArtifactsByRun` | `agent_team.go` | Medium. Same as P11. |
| P13 | `ListTeamTasksByRun` | `agent_team.go` | Low. Bounded by guardrails. |
| P14 | `ListAssignmentsByTeamRun` | `agent_team.go` | Low. Bounded by guardrails. |
| P15 | `ListAgentRunEventsByTaskID` | `agent.go` | Medium. No LIMIT by default (filter has optional limit). |
| P16 | `GetSettings` | `user_settings.go` | Low. Settings count per user is bounded. |
| P17 | `ListDevicesByUser` | `device.go` | Low. Device count per user is bounded. |

### 6.2 Properly Paginated Endpoints

| Endpoint | File | Pattern | LIMIT/OFFSET |
|----------|------|---------|--------------|
| `GetMessagesBySession` | `message.go` | Cursor (`beforeSeq`) + LIMIT | Capped at `MaxMessagePageLimit(100)` |
| `GetMessagesIncrement` | `message.go` | Cursor (`afterSeq`) + LIMIT | Capped at `MaxIncrementalMessageLimit(500)` |
| `SearchMessages` | `message.go` | LIMIT only | Capped at `MaxMessagePageLimit(100)` |
| `SearchAllMessages` | `message.go` | LIMIT only | Capped at `MaxMessagePageLimit(100)` |
| `ListNotifications` | `notification.go` | LIMIT + OFFSET | Capped at `MaxMessagePageLimit(100)` |
| `ListWorkspaces` | `workspace.go` | Cursor (`id > cursor`) + LIMIT | Default 50, max 200 |
| `ListAgentProfiles` | `agent_profile.go` | Cursor + LIMIT | Default 50, max 200 |
| `ListPublicProfiles` | `agent_profile.go` | Cursor (multi-sort) + LIMIT | Default 50, max 200 |
| `ListExecutionTargets` | `execution_target.go` | Cursor + LIMIT | Default 50, max 200 |
| `ListMCPServers` | `mcp_server.go` | Cursor + LIMIT | Default 50, max 200 |
| `ListSkills` | `skill.go` | Cursor + LIMIT | Default 50, max 200 |
| `ListProviderBindings` | `provider_binding.go` | Cursor + LIMIT | Default 50, max 200 |
| `ListAuditEvents` | `audit.go` | Cursor (`id < cursor`) + LIMIT | Default 50, max 200 |

---

## 7. Additional Findings

### 7.1 Performance

| # | File | Issue | Severity |
|---|------|-------|----------|
| F1 | `session.go` `ListUserSessions` | Subquery `(SELECT session_id, COUNT(*) ... FROM session_members ... GROUP BY session_id)` is computed for every call. This is a correlated subquery that scans all session_members. | Medium. Pre-compute or use a materialized view for member_count. |
| F2 | `session.go` `ListUserSessions` | No LIMIT on result set. Users with hundreds of sessions will cause large payloads. | Medium |
| F3 | `message.go` `SearchSessions` | `LIKE` pattern `"%" + q + "%"` without `escapeILIKE()` allows wildcard injection (user can inject `%` or `_` to match more than intended). | Low (information leak, not security) |
| F4 | `db.go` | `PrepareStmt: true` enables prepared statement caching. Good for performance. | Positive |
| F5 | `db.go` | Connection pool: 10 idle, 100 max, 1h lifetime. Reasonable defaults. | Positive |

### 7.2 Correctness

| # | File | Issue | Severity |
|---|------|-------|----------|
| C1 | `session.go` `FindPrivateSessionBetween` | Does not filter `s.dissolved = false`. If a private session is dissolved, it could be returned as an existing session, preventing creation of a new one. | Medium |
| C2 | `session.go` `SearchSessions` | WHERE clause `AND (s.type = 'group' OR (s.type = 'private'))` is a no-op tautology (every session is either group or private). Appears to be leftover from refactoring. | Low (cosmetic) |
| C3 | `agent_team.go` `GetTeamRunBySessionID` | Returns only the most recent team run for a session. If multiple team runs share a session, only the latest is returned. This appears intentional. | Informational |
| C4 | `user_settings.go` `UpsertSettings` | Loops over map with individual upserts. If one fails midway, partial state persists. | Medium |
| C5 | `refresh_token.go` `UpsertRefreshToken` | Read-then-write pattern is not atomic. Two concurrent requests for the same user+device could both find "not found" and attempt Create. One will fail on unique constraint. | Low (the unique constraint prevents data corruption) |

### 7.3 Data Integrity

| # | File | Issue | Severity |
|---|------|-------|----------|
| D1 | `agent_team.go` `DeleteTeam` | Hard-deletes `agent_teams` row. Related `agent_team_members` have `ON DELETE CASCADE`, but `agent_team_runs` do NOT cascade. This leaves orphaned team runs. | Medium. Add cascade or soft-delete teams. |
| D2 | `agent_team.go` `RemoveTeamMember` | Hard-deletes `agent_team_members`. Related assignments reference `from_member_id` and `to_member_id` with no cascade, potentially leaving dangling references. | Medium |
| D3 | `session.go` `SearchSessions` | Raw SQL builds LIKE pattern without escaping `%`/`_` in user input (unlike `message.go` which has `escapeILIKE`). | Low |

---

## 8. Per-Repo Summary

| File | SQL Injection | N+1 | Missing Index | Soft Delete | Pagination | Transactions |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| `db.go` | OK | - | - | - | - | OK |
| `migrate.go` | OK | - | - | - | - | N/A |
| `message.go` | OK | - | - | - | OK | OK |
| `session.go` | OK | - | - | C1, C2 | P1, P2 | OK |
| `user.go` | OK | - | - | OK | OK | T1 |
| `friendship.go` | OK | - | - | N/A | P6, P7 | OK |
| `workspace.go` | OK | - | M13 | N/A | OK | OK |
| `agent.go` | OK | N4 | M11 | S1-S3 | P3-P5, P15 | OK |
| `agent_profile.go` | OK | - | OK | OK | OK | OK |
| `agent_team.go` | OK | N5-N7 | M3-M7, M9 | D1, D2 | P10-P14 | OK |
| `execution_target.go` | OK | - | OK | OK | OK | OK |
| `device.go` | OK | - | OK | N/A | P17 | OK |
| `notification.go` | OK | - | OK | N/A | OK | OK |
| `attachment.go` | OK | - | OK | N/A | OK | OK |
| `user_settings.go` | OK | N1 | OK | N/A | P16 | C4 |
| `message_reaction.go` | OK | - | OK | N/A | OK | OK |
| `message_attachment.go` | OK | - | OK | N/A | OK | OK |
| `session_member.go` | OK | - | OK | OK | P8 | T3 |
| `refresh_token.go` | OK | - | OK | N/A | OK | T2 |
| `mcp_server.go` | OK | - | OK | OK | OK | OK |
| `skill.go` | OK | - | OK | OK | OK | OK |
| `provider_binding.go` | OK | - | OK | N/A | OK | OK |
| `audit.go` | OK | - | OK | N/A | OK | OK |

---

## 9. Priority Recommendations

### Critical (Fix Now)

None found. The repository layer is generally well-structured with no SQL injection risks.

### High Priority

1. **M1:** Add index on `custom_agents(owner_user_id) WHERE deleted_at IS NULL`
2. **M3:** Add index on `agent_teams(owner_id)`
3. **M4:** Add index on `agent_team_members(team_id)`
4. **M7:** Add index on `agent_team_runs(team_id)`
5. **M9:** Add index on `agent_team_assignments(team_run_id, to_member_id)` (already exists as `team_run_id` single-column; add composite)
6. **M11:** Add index on `pending_agent_tasks(agent_instance_id)`
7. **M13:** Add index on `workspaces(owner_id)`
8. **C1:** Fix `FindPrivateSessionBetween` to filter `s.dissolved = false`

### Medium Priority

9. **N1:** Batch `UpsertSettings` into single Create call
10. **N3:** Batch membership checks in `AddGroupMembers`
11. **T3:** Wrap member addition in `AddGroupMembers` in a transaction
12. **T2:** Replace read-then-write in `UpsertRefreshToken` with atomic upsert
13. **P1/P2:** Add LIMIT to `ListUserSessions` / `ListWorkspaceSessions`
14. **D1/D2:** Consider cascade deletes or soft-deletes for teams and team members
15. **F1:** Optimize member_count subquery in session listing (pre-compute or materialize)

### Low Priority

16. **C2:** Remove tautological WHERE clause in `SearchSessions`
17. **D3/F3:** Apply `escapeILIKE` to session search LIKE pattern
18. **P6:** Consider LIMIT for `ListAcceptedFriends`
19. **P10-P12:** Consider LIMIT for team run event/artifact listing endpoints
