---
name: TokenDance governance
about: Cross-system work for identity, Feishu, design, packaging, SEO/i18n, or docs hygiene
title: "Governance: "
labels: governance
assignees: ""
---

## Area

- [ ] TokenDance ID / OIDC relying-party flow
- [ ] Feishu/Lark integration
- [ ] Design system / `--td-*` token usage
- [ ] Product packaging / README / docs
- [ ] Agent/SEO/i18n
- [ ] Security or risk register

## Goal

Describe the user-facing or system-level outcome.

## Cross-System Boundary

- TokenDance root docs:
- TokenDance ID impact:
- AgentHub Hub/Edge/Desktop/Web impact:
- Public site or docs impact:

## Acceptance Criteria

- [ ] Uses TokenDance ID as the identity authority; no direct social-provider login is added to AgentHub.
- [ ] Product-local authorization is enforced after TokenDance ID identity is mapped to AgentHub user/session/role.
- [ ] Design changes use existing tokens or `--td-*`; no unrelated palette is introduced.
- [ ] Public docs avoid live host paths, SSH aliases, secrets, provider keys, and rollback commands.
- [ ] README/AGENTS/docs are updated together if behavior or positioning changes.

## Evidence

List tests, docs, screenshots, command output, or links needed to prove completion.
