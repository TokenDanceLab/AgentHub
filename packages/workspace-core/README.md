# AgentHub Workspace Core

Shared Go domain models and helpers for workspace state.

Owns:

- workspace identity.
- worktree metadata.
- patch metadata.
- changed-file metadata.

Runtime worktree creation and patch application live in `services/runner`.
