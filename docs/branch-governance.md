# 分支治理

最后更新：2026-05-24

## 合并规则

```
feat/* → dev/delicious233 → master
```

- `master` 禁止直接 push，必须通过 PR
- `dev/*` 合并前本地验证：`go test ./...` + `pnpm test` + `pnpm build`
- 合并前先 rebase 到最新 `dev/delicious233`

## 当前分支状态

| 分支 | ahead | behind | 状态 |
|------|:--:|:--:|------|
| **dev/delicious233** | — | 0 | ★ 主开发分支，唯一事实源 |
| dev/johnny | 6 | 176 | 严重过期，PR #52 替代 |
| dev/trump | 22 | 50 | Trump 的 Web 前端，不合并 |
| feat/trump-webui | — | — | 废弃（Trump 实际在 feat/frontend-page-preview） |
| sync/johnny-full | 9 | 2 | Johnny 最新同步，PR #52 |
| master | 4 | 176 | 严重过期，待 Q2 验收后强制同步 |

## 给 Johnny 的 PR

- **PR #52**: `sync/johnny-full → dev/johnny`
- 包含全部 dev/delicious233 改动（E2E + CI + 测试 + 审计 + 文档）
- 定期从 dev/delicious233 更新 sync 分支
- Johnny 合并后删除 dev/johnny，直接以 dev/delicious233 为主

## 给 Trump

- 活跃分支：`feat/frontend-page-preview`
- 不要合并到 dev/delicious233
- 最终由 Trump 自行决定是否 PR

## 给 Delicious233（自己）

- dev/delicious233 是唯一事实源
- 定期 push，每次变更后跑全量测试
- 跨方向改动尽早 PR
- 不在共享分支 force-push
