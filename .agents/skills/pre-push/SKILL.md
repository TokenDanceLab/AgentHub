---
name: pre-push
description: Push 前全量验证 —— 编译/测试/覆盖率/格式化/lint/E2E。Agent 应在 commit 后 push 前主动使用。
---

# Pre-Push Verification

Push 前运行全量检查，确保 CI 不会红。

## 检查清单

### 1. Go (Edge Server + Hub Server)

```powershell
cd edge-server
go build ./...           # 编译通过
go vet ./...             # 静态分析
go test ./... -short     # 单元测试（跳过集成）
go tool cover -func coverage.out | findstr total  # ≥ 70%

cd ..\hub-server
go build ./...           # 编译通过
```

### 2. TypeScript (Desktop)

```powershell
cd app\desktop
pnpm test --run          # 132 tests expected
pnpm lint -- --max-warnings 10
pnpm typecheck           # tsc --noEmit
pnpm build               # Vite 构建成功
```

### 3. E2E Integration

```powershell
.\scripts\integration-e2e.ps1 -SkipBuild -Agent claude-code
# 期望: 5/5 pass
```

OpenCode 和 Codex E2E 在 API key/额度不可用时跳过，不阻塞 push。

### 4. Git

```powershell
git diff --check         # 空白检查
git status --short       # 确认无遗漏文件
```

### 5. 快速验证（仅改文档/CSS 时）

如果只改了 `.md` 或 `.css` 文件，可以跳过 Go 和 E2E 检查，只需：

```powershell
pnpm test --run && pnpm build
git diff --check
```

## 失败处理

| 检查 | 失败时 |
|------|--------|
| go build | 必须修复才能 push |
| go test | 必须修复才能 push |
| coverage < 70% | 补测试或更新阈值 |
| pnpm test | 必须修复才能 push |
| pnpm build | 必须修复才能 push |
| E2E claude-code | 检查是否环境问题（PATH/API key） |
| E2E opencode/codex | 跳过，记录到 ROADMAP |
