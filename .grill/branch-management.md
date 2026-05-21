# Grill: branch management
Date: 2026-05-21

## Intent
Keep AgentHub branch and PR management simple enough for a three-person team while still preventing protocol, docs and implementation work from trampling each other.

## Constraints
- Team size is three people.
- Do not introduce heavy GitFlow.
- Rules must be visible in project-level `AGENTS.md`.
- GitHub should track the branch/process work in one aggregated issue.

## Key decisions
- Decision: use a lightweight trunk-based workflow. Reason: `master` stays easy to understand and demo from, while short branches keep work reviewable. Alternative considered: GitFlow with develop/release/hotfix branches, rejected as too much process for three people.
- Decision: branch names are lowercase kebab-case with a small prefix set. Reason: predictable names help humans and agents route work without extra ceremony. Alternative considered: per-person long-lived branches, rejected because they hide integration problems.
- Decision: code and protocol work should go through PR; tiny docs/process cleanups may be direct only when low risk. Reason: implementation needs review, but docs-only cleanup should not require artificial overhead.

## Surfaced assumptions
- GitHub currently has architecture issues and labels, but no branch workflow issue.
- The team values clarity over strict enterprise controls.
- Branch protection can be added later when real code and CI exist.

## Out of scope
- Full release branch policy.
- Automated GitHub branch protection setup.
- Required multi-reviewer approval.
