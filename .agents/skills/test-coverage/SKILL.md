---
name: test-coverage
description: 运行测试 + 覆盖率分析 + 识别低覆盖目标。Agent 应在完成代码变更后主动使用，或用户说"检查覆盖率""跑测试"时使用。
---

# Test Coverage

运行 AgentHub 全项目测试，分析覆盖率，定位薄弱点。

## 触发时机

- 完成代码变更后
- 用户说"检查覆盖率""跑测试""测试覆盖率多少"
- CI 覆盖率低于阈值时

## 检查步骤

### 1. Edge Server (Go)

```powershell
cd edge-server
go test ./... -count=1 -short -coverprofile=coverage.out
go tool cover -func=coverage.out | findstr total
```

阈值：70%（CI 强制）。低于阈值时列出最低覆盖的 5 个函数。

### 2. Desktop (TypeScript)

```powershell
cd app/desktop
pnpm test --run          # 132 tests expected
pnpm lint -- --max-warnings 10
pnpm build               # must succeed
```

### 3. E2E Integration

```powershell
.\scripts\integration-e2e.ps1 -SkipBuild -Agent claude-code
```

期望：5/5 pass。如果 OpenCode/Codex 不可用，跳过不影响结论。

### 4. 报告格式

```markdown
## Coverage Report

| Module | Coverage | Tests | Status |
|--------|----------|-------|--------|
| edge-server | 72.0% | 10 packages | ✅ above 70% |
| app/desktop | N/A | 132 | ✅ all pass |
| E2E claude-code | 5/5 | 1 suite | ✅ |
| E2E opencode | 2/5 | 1 suite | ⚠️ in progress |

### 低覆盖函数 (< 50%)
| File | Function | Coverage |
|------|----------|----------|

### 建议
1. 优先补 XXX 函数测试（0% 覆盖）
2. ...
```

## 注意

- Go 使用 `-short` 跳过需要真实 CLI 的集成测试
- Desktop 测试不设硬性覆盖率要求
- E2E 需要对应 CLI 二进制和 API key 才能完整运行
