---
name: pre-push
description: Push 前全量验证 —— 编译/测试/覆盖率/格式化/lint/E2E。Agent 应在 commit 后 push 前主动使用。
最后更新：2026-05-24
---

# Pre-Push Verification

Push 前运行全量检查，确保 CI 不会红。

## 检查清单

### 1. Go — Edge Server

```powershell
cd edge-server
go build ./...                    # 编译
go vet ./...                      # 静态分析
go test ./... -short -count=1     # 单元测试（-short 跳过集成）
# 期望: 11/11 包通过
```

### 2. Go — Hub Server

```powershell
cd hub-server
go build ./...                    # 编译
go vet ./...                      # 静态分析
go test ./... -short -count=1     # 单元测试
# 期望: 12/12 包通过（含 auth/config/cache/service/handler/middleware/jwtutil/model/errcode/ws/uuidv7/tests）
```

### 3. TypeScript — Desktop

```powershell
cd app\desktop
pnpm tsc --noEmit                # 类型检查
pnpm test                        # 单元测试 + 集成
# 期望: 278 tests 通过（21 test files）
pnpm build                       # Vite 构建
```

### 4. Git

```powershell
git diff --check                 # 空白检查
git status --short               # 确认无遗漏文件
```

### 5. 快速验证（仅改文档/CSS 时）

只改 `.md` 或 `.css` 文件时跳过 Go 检查：

```powershell
pnpm test && pnpm build
git diff --check
```

## 失败处理

| 检查 | 失败时 |
|------|--------|
| go build | 必须修复才能 push |
| go test | 必须修复才能 push |
| go vet | 必须修复才能 push |
| pnpm tsc | 必须修复才能 push |
| pnpm test | 必须修复才能 push |
| pnpm build | 必须修复才能 push |
| E2E (claude-code) | 检查环境（PATH/API key） |
| E2E (opencode/codex) | 跳过，记录到 ROADMAP |
