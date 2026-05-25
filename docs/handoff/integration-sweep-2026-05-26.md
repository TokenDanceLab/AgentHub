# Integration Sweep Handoff - 2026-05-26

This note records the integration agent's saved progress. It intentionally does
not claim ownership of the active `dev/delicious233` worktree or the Web/UI/OIDC
work in progress.

## Branch And PR

- Integration branch: `feat/team-integration-sweep`
- Current saved HEAD: `edf19be`
- Remote branch: `origin/feat/team-integration-sweep`
- Draft PR: https://github.com/TokenDanceLab/AgentHub/pull/197
- Working surface used by this agent: `.worktrees/team-integration-verify`

The main worktree remains active on `dev/delicious233`. Do not clean, reset,
stage, or commit the main worktree from this integration branch.

## What Is Integrated

The integration branch currently contains:

- `origin/feat/team-adapter-compat`
- `origin/feat/team-hub-reliability`
- `origin/feat/team-hub-authz`
- `origin/feat/team-johnny-merge`
- Latest `dev/delicious233` through `69085d5`

The latest dev merge reconciled Hub migration numbering to:

- `0020_token_dance_sub`
- `0021_devices_allow_multiple_same_type`
- `0022_agent_profiles`
- `0023_execution_targets`
- `0024_message_attachments`
- `0025_skills`
- `0026_mcp_servers`
- `0027_provider_bindings`
- `0028_audit_events`

## Saved Verification

Fresh local verification on `feat/team-integration-sweep`:

- `cd edge-server && go test ./... -short -count=1`
- `cd hub-server && go test ./... -short -count=1`
- OpenAPI YAML parse with PyYAML
- migration `.up.sql` numeric prefix duplicate check
- `git diff --check dev/delicious233..HEAD`

All of the above passed before the branch was pushed.

## Public Tracking

- Created #196 for the required Hub migration chain smoke before merge/release:
  https://github.com/TokenDanceLab/AgentHub/issues/196
- Commented #83 that notification ownership scoping is addressed on the
  integration branch but should only be closed after merge.
- Commented #102 and #67 that the branch only improves adjacent permission
  plumbing; full Desktop permission blocking and API pending-request validation
  remain open.
- Added a PR CI triage comment on #197:
  https://github.com/TokenDanceLab/AgentHub/pull/197#issuecomment-4535615384

## CI Status

PR #197 is intentionally still draft. CI currently exposes blockers outside the
backend/runtime integration scope:

- Frontend install fails because active Web/UI files on the current development
  line contain unresolved conflict markers.
- Go lint fails because the workflow pins `golangci-lint-action` to `v1.64`
  while both Go modules target `go 1.25.0`.
- Ubuntu cross-platform Edge test exposes OS-specific behavior in
  `TestFileStoreRejectsUnwritableSnapshotPathOnStartup`; local Windows short
  tests passed.

Do not silently resolve the Web/UI conflict markers from this branch. The active
Web/UI owner should checkpoint or finish that work.

## Coordination Rule

Do not force-interrupt active agents on `dev/delicious233`. The safer rule is:

- active agents finish their current task card;
- each owner commits logical slices when done;
- new large work uses feature branches or worktrees;
- integration PRs remain draft until owners finish and CI blockers are assigned.

Only intervene in another agent's worktree after explicit user confirmation or
if the owner is gone and the branch is blocking release.
