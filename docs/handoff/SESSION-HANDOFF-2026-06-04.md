# AgentHub 分支合并交接文档 — 2026-06-04

## 背景

dev/delicious233 有 55 个 commit 未合入 master。本次操作分两步完成了合并。

## Round 1: 整理工作区 → PR #235 (squash merged)

### 前处理
工作区有 52 个未提交文件 + 13 个 untracked 文件。按逻辑分组提交：

| 提交 | 内容 |
|------|------|
| `docs` | ADR 重新编号 001-005 → 001-011，旧文件 git rm，新文件 git add，新增 ADR README |
| `test(hub)` | agent_team_extra_test.go + repository_test.go 补充 |
| `docs` | AGENTS.md / governance / roadmap / security 文档同步 |
| `chore` | pnpm-lock.yaml 同步 |
| `chore(desktop)` | package.json + Cargo.toml + Cargo.lock 依赖更新 |
| `feat(desktop)` | OIDC callback server 增强 + Edge manager（6 个 Rust 文件） |
| `feat(desktop)` | hubAuth.ts / edgeAuth.ts / main.tsx / App.tsx auth 改进 |
| `style(desktop)` | 20 个 CSS 文件 glass token + dark/light 统一 |
| `feat(desktop)` | i18n en/zh 翻译 + PromptInput + 测试 |
| `chore` | .gitignore 补充 package-lock.json 黑名单 |

### 注意事项
`.gitignore` 原本缺少 `package-lock.json` 规则（项目只用 pnpm），补充后 `app/desktop/package-lock.json` 被自动忽略。

### 合并
`gh pr create --base master --head dev/delicious233` → PR #235 → `gh pr merge 235 --squash`。

## Round 2: Rebase 到 master 最新 → PR #236

### 问题
Round 1 合并后 master 前进了一个 squash commit，dev/delicious233 上还有 49 个历史 commit 与 `origin/master` 存在冲突。

### Rebase 策略
使用 `git rebase origin/master -X theirs`（rebase 端优先）批量解决，避免了 5 次以上手动解 conflict。

自动 drop 11 个 commit（内容已被 squash 或已 upstream），rebase 成功。

### Force push 失败
`dev/delicious233` 是 GitHub 受保护分支，禁止 force push。

### 解决方案：recreate 分支 + merge
```
git checkout master
git branch -D dev/delicious233
git checkout -b dev/delicious233 master
git pull origin dev/delicious233   # 重拉 rebase 后的状态
git merge origin/dev/delicious233 --no-edit -X theirs
```

### 合并
`gh pr create` → PR #236 → `gh pr merge 236 --squash --delete-branch`。

## 冲突文件及解决方式

| 冲突文件 | 冲突类型 | 解决 |
|----------|----------|------|
| `app/desktop/src/components/ChatView.module.css` | scroll-to-bottom 按钮 shadow 值不同 | 用 rebase 端（`-X theirs`） |
| `app/desktop/src/components/ChatView.tsx` | pending thinking 条件判断差异 | 用 rebase 端 |
| `app/desktop/src/i18n/locales/en.json` | ArtifactPreview streaming card 相关翻译 | 用 rebase 端 |
| `app/desktop/src/i18n/locales/zh.json` | 同上 | 用 rebase 端 |
| `app/desktop/src/components/PromptInput.tsx` | critical fixes 恢复 | 用 rebase 端 |
| `docs/guides/local-dev-setup.md` | add/add conflict（两边都新增） | `-X theirs` |

所有冲突均以 `-X theirs`（rebase commit 内容）解决，与 master squash 内容一致。

## 当前最终状态

- **master**: `f679d1a1 feat: AgentHub v0.1 里程碑（已 rebase master）`
- **dev/delicious233**: 已删除（squash merge 后自动清理）
- 本地 master 已 `git pull --ff-only` 同步

## 给 Codex 的注意事项

1. **重新创建 dev 分支**：本地 master 已同步。如果需要继续在 dev/delicious233 工作，运行 `git checkout -b dev/delicious233`。
2. **gitignore 已更新**：`package-lock.json` 现在被忽略。如果在别处看到它 untracked，是正常的。
3. **Tauri 配置已回退**：`tauri.conf.json` 保持原始 `transparent: true` + `decorations: false`，没有改动。
4. **pnpm-lock.yaml 已同步**：依赖更新后的 lockfile 已提交。
5. **Mobile APK 已安装到模拟器**：`emulator-5556`，APK 路径 `app/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。
6. **Edge Server 启动命令**（本地开发）：`go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --dev --runner-profile claude-code`
