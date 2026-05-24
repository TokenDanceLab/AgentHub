# 分支治理

最后更新：2026-05-24（Desktop P0 完成 + 生产部署）

## 合并规则

```
feat/* → dev/maintainer → master
```

- `master` 禁止直接 push，必须通过 PR
- `dev/maintainer` 合并前本地验证：`go test ./...` + `pnpm test` + `pnpm build`
- 合并前先 rebase 到最新 `dev/maintainer`

## 当前分支状态

| 分支 | 说明 | 状态 |
|------|------|:--:|
| **dev/maintainer** | 主开发分支，唯一事实源 | ★ 活跃 |
| master | 稳定发布，PR only | Q2 验收后同步 |
| dev/contributor-b | contributor-b 的 Web 前端（feat/frontend-page-preview） | 不合并 |
| dev/contributor-a | 已过期 | 待清理 |

## 给 contributor-b

- 活跃分支：`feat/frontend-page-preview`
- 不要合并到 dev/maintainer
- 最终由 contributor-b 自行决定是否 PR

## 给 maintainer（自己）

- dev/maintainer 是唯一事实源
- 定期 push，每次变更后跑全量测试
- 跨方向改动尽早 PR
- 不在共享分支 force-push
