# AgentHub Workflow 标准化规范

> 2026-06-27 | 所有后续 Workflow 必须遵守此模板

## 通用开发五阶段

每个开发执行段必须包含以下 5 个 gate，缺一不可。spec-driven-develop 可以在这些 gate 外增加 SPEC、计划、进度追踪和归档阶段，但不能省略执行段的验证门禁。

```
1. Execute     执行实际开发任务
2. Self-Test   开发者自测（go test / pnpm test / bash -n）
3. Gate        门禁检查（对照 acceptance criteria 逐项验证）
4. Cross-Review 交叉审查（独立 agent 审查 diff，找 bug/风格/安全/完整度问题）
5. VERIFY      最终验证（build + 全量测试 + diff check + 范围/视觉证据）
```

## 各阶段要求

### 1. Execute
- 明确任务范围（哪些文件可改、哪些不可改）
- 标注约束（scope、no secrets、Chinese docs、UIUX 验收等）
- 输出：代码变更

### 2. Self-Test
- Go 代码：`go build ./... && go test ./... -short -count=1`
- 前端代码：`pnpm typecheck && pnpm test`
- Shell 脚本：`bash -n`
- YAML/JSON：语法校验
- 输出：测试结果（pass/fail 列表）

### 3. Gate
- 逐项对照 acceptance criteria 检查
- 检查是否有意外修改（git diff --stat 验证只改了预期文件）
- 检查隐私红线（无 live host、无 secret、无敏感路径）
- 输出：门禁通过/阻塞，阻塞项列表

### 4. Cross-Review
- 独立 agent，只读审查
- 4 维审查：正确性 / 代码风格 / 安全性 / 完整度
- 输出：审查发现（file:line 引用）

### 5. VERIFY
- 全量 build + test（hub + edge + frontend）
- git diff --check（空白/冲突检查）
- UI 相关改动必须附 Playwright、截图或人工验收证据；非 UI 任务用 diff scope 证明没有意外改动
- 输出：全部通过或阻塞项列表

## 真实 E2E 证据等级

涉及真实 E2E、Playwright、Visual QA、approved-real、打包 Desktop、性能/泄漏或 merge-ready 结论时，执行段必须先按 `.agents/skills/real-e2e-acceptance/SKILL.md` 标注证据等级。一个 gate 只能证明它实际覆盖的层级，不能用更高等级措辞包装。

| 证据等级 | 能证明 | 不能证明 |
|---|---|---|
| Fixture/unit | 纯合同、normalizer、模型逻辑 | 浏览器、网络、运行时、打包 |
| Playwright UI | 真实浏览器交互、顺序、滚动、可见状态 | packaged Tauri、真实登录、真实 CLI/model/API |
| Visual QA | 截图、几何、溢出、遮挡、视觉回归 | 数据正确性、后端健康、运行时执行 |
| Stubbed Hub | Hub-shaped Web 合同和回放边界 | 真实 Hub 可用性、真实登录、模型消耗 |
| Observed local | 本地 Edge/Hub 只读或无消耗路径 | 云端生产、真实模型/API、安装包 |
| Approved real | 明确审批后的真实登录、CLI、模型或 API 路径 | 打包/签名/release，除非对应 gate 也跑过 |
| Backend/API | handler、service、权限、API 合同 | 浏览器 UX、renderer 几何、Desktop 打包 |
| Performance/leak | 指定路径的 benchmark/load/pprof/leak 证据 | 功能正确性，除非配套行为测试 |
| Packaged release | Tauri sidecar/icon/installer/signing/update 证据 | 运行时/model 正确性，除非配套运行时 gate |

Stub、fixture、readiness-only 或 manifest-only 输出必须保留 `real_tested=false`。Vite renderer、Stubbed Hub、Observed local、Approved real、Packaged release 是不同证据层，PR 和文档不得混写。

## 反模式（禁止）

- ❌ 只有 Execute 没有 VERIFY 的 Workflow
- ❌ Execute agent 自己验收自己（必须独立 agent 审查）
- ❌ 跳过 Gate 直接 commit
- ❌ Cross-Review 只在最后做（应该在 self-test 之后、VERIFY 之前）
- ❌ 把已归档 spec-driven 专项继续当成当前活跃任务
- ❌ 把 Stubbed Hub、fixture 或 readiness-only 结果写成真实登录、真实 CLI/model/API、packaged Desktop 或 release 通过
