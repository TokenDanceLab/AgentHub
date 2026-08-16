# AgentHub History

最后更新：2026-08-16

本文件是 AgentHub 源仓的历史材料索引。历史 longform、日期型审计、旧发布材料、过期设计、参考调研、完成的 spec-driven 工件和过期项目 skill 不再保存在 AgentHub active source tree。

## External Archive

| Field | Value |
|---|---|
| Archive repository | `TokenDanceLab/docs` |
| History archive PR | TokenDanceLab/docs#1 |
| History archive commit | `8417e00b` merge commit; source archive commit `e94cb7d` |
| ADR archive PR | TokenDanceLab/docs#2 |
| ADR archive commit | `50c360e` merge commit; source archive commit `4fe876b` |
| Root evidence archive PR | TokenDanceLab/docs#3 |
| Root evidence archive commit | `bc774192` merge commit; source archive commit `6cb00e9` |
| Repo structure SPEC archive PR | TokenDanceLab/docs#4 |
| Repo structure SPEC archive commit | `b7c6478d` merge commit; source archive commit `b845480` |
| Archive root | `archive/agenthub/` |

## Migrated Paths

| Former AgentHub path | External archive path |
|---|---|
| `docs/archive/` | `archive/agenthub/repo/docs/archive/` |
| `docs/archives/` | `archive/agenthub/repo/docs/archives/` |
| `docs/adr/` | `archive/agenthub/repo/docs/adr/` |
| archived project skills | `archive/agenthub/repo/docs/archives/project-skills/` |
| `css-audit-results.json` | `archive/agenthub/repo/root-evidence/css-audit-results.json` |
| repo structure cleanup SPEC | `archive/agenthub/repo/specs/repo-structure-doc-tooling-cleanup/` |

## Pending External Archive (in-repo, awaiting migration)

以下文件已无活跃引用、本通道仅标注 `pending external archive — see docs/history.md`，未真外迁（外迁需管理员）。

**外迁规则**：物理外迁由管理员执行（单次归档 PR：文件移入外部 TokenDanceLab/docs 归档，源仓删除正文），本表是源仓留存索引；外迁前不得重写或继续引用这些文件，新历史材料直接写入外部归档。

| Path | Kind |
|---|---|
| `docs/archives/analysis/hub-service-boundary-map.md` | historical boundary map |
| `docs/archives/analysis/post-polish-module-inventory.md` | post-polish inventory |
| `docs/archives/analysis/post-polish-project-overview.md` | post-polish overview |
| `docs/archives/analysis/post-polish-risk-assessment.md` | post-polish risk |
| `docs/archives/analysis/settings-empty-error-inventory.md` | settings inventory |
| `docs/archives/analysis/settings-sectionid-residual-inventory.md` | settings inventory |
| `docs/archives/analysis/frontend-dedupe-plan.md` | strangler plan |
| `docs/archives/plan/post-polish-milestones.md` | post-polish plan |
| `docs/archives/plan/post-polish-dependency-graph.md` | post-polish plan |
| `docs/archives/plan/post-polish-task-breakdown.md` | post-polish plan |
| `docs/archives/handoff/2026-07-20-phase-74-75-handoff.md` | phase handoff |
| `docs/archives/branch-hygiene.md` | branch cleanup record |

## Rules

- Use active AgentHub docs for current rules, architecture, roadmap, APIs, and SPEC progress.
- Treat external archive material as trace-only. It does not prove current branch state, real login, real model/API execution, packaged Desktop behavior, release upload, or production deployment.
- Do not recreate `docs/archive/`, `docs/archives/`, or `docs/adr/` in AgentHub. Add new historical material to the external TokenDance docs archive and update this index.
