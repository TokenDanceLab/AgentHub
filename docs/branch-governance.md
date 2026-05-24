# 分支治理

最后更新：2026-05-24（M5+M6 批次完成，生产部署 host-redacted）

## 合并规则

```
feat/* → dev/maintainer → master
```

- `master` 禁止直接 push，必须通过 PR
- `dev/*` 合并前本地验证：`go test ./...` + `pnpm test` + `pnpm build`
- 合并前先 rebase 到最新 `dev/maintainer`

## 当前分支状态

| 分支 | ahead | behind | 状态 |
|------|:--:|:--:|------|
| **dev/maintainer** | — | 0 | ★ 主开发分支，唯一事实源 |
| dev/contributor-a | 6 | 176 | 严重过期，PR #52 替代 |
| dev/contributor-b | 22 | 50 | contributor-b 的 Web 前端，不合并 |
| feat/contributor-b-webui | — | — | 废弃（contributor-b 实际在 feat/frontend-page-preview） |
| sync/contributor-a-full | 9 | 2 | contributor-a 最新同步，PR #52 |
| master | 4 | 176 | 严重过期，待 Q2 验收后强制同步 |

## 给 contributor-a 的 PR

- **PR #52**: `sync/contributor-a-full → dev/contributor-a`
- 包含全部 dev/maintainer 改动（E2E + CI + 测试 + 审计 + 文档）
- 定期从 dev/maintainer 更新 sync 分支
- contributor-a 合并后删除 dev/contributor-a，直接以 dev/maintainer 为主

## 给 contributor-b

- 活跃分支：`feat/frontend-page-preview`
- 不要合并到 dev/maintainer
- 最终由 contributor-b 自行决定是否 PR

## 给 maintainer（自己）

- dev/maintainer 是唯一事实源
- 定期 push，每次变更后跑全量测试
- 跨方向改动尽早 PR
- 不在共享分支 force-push
