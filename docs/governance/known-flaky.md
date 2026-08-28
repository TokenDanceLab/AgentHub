# 已知 flaky 测试登记表（known-flaky）

> Owner：本文件是 AgentHub「flake 登记、重试预算与 CI annotation 约定」的 SSOT。其他文档涉及 flaky 处置时以本文件为准，不复制规则。
> 相关：规则 → 机器验证映射见 [verifier-map](verifier-map.md)。本登记表暂无机器门禁，靠到期复审纪律与评审执行。

最后更新：2026-08-28（FLK-001 根因修复并归档）

## 为什么需要登记表

Flaky 测试侵蚀门禁可信度：一旦「偶发红、重跑转绿」成为默认操作，真实回归会被习惯性重跑掩盖。登记表强制三件事：

1. **有登记**：每个已知 flake 都有书面条目，含 owner、首现日期、复现命令与到期复审日。
2. **有到期**：登记项必须带到期复审日；到期未修复即移除登记并修根因——重试预算仅为临时容错手段，不得作为已知 flake 的长期规避方式。
3. **重跑留痕**：任何「重跑/重试转绿」必须在当日回填登记或处置记录，禁止静默重跑。

## 登记字段合同

每个登记项包含以下字段：

| 字段 | 要求 |
|---|---|
| 编号 | `FLK-<三位序号>`，只增不复用 |
| 测试标识 | 包路径 + 测试名，或 spec 文件 + 用例名 |
| 车道 | CI job（对齐 checks.yml 的 job ID）与运行平台 |
| Owner | 模块车道维护者（写车道角色，不写个人） |
| 首现日期 | 绝对日期 `YYYY-MM-DD` |
| 复现命令 | 本地或 CI 可执行的窄化运行命令；压测复现参数（`-count` / `--repeat-each` 等）写明 |
| 到期复审日 | 绝对日期，登记时必填 |
| 状态 | 待修复 / 修复中 / 观察中 / 已修复（归档） |
| 处置记录 | 每次发生一行：日期、现象、处置动作、结果 |

## 到期与移除规则

- 到期前修复：在处置记录写明根因结论与修复证据，状态转「已修复（归档）」，下次维护窗口从活跃登记表移除。
- 到期未修复：登记失效并移除；owner 必须修复根因，或走正常门禁变更流程临时停用该用例——不得继续占用重试预算。
- 复审日续期需在 PR 中说明理由，且只允许续期一次。

## 重试预算

| 车道 | 框架（配置位置） | 重试预算 |
|---|---|---|
| 前端单元（shared / workbench / desktop / web / mobile-rn） | vitest（`app/<pkg>/vitest.config.ts`） | 0 |
| Web E2E（stubbed-hub） | Playwright（`app/web/playwright.config.ts`） | 0 |
| Desktop E2E | Playwright（`app/desktop/playwright.config.ts`） | 0 |
| Mobile E2E（light） | Playwright（`app/mobile-rn/playwright.config.ts`） | 1 |
| Go 单元（go-edge / go-hub / windows-go-test 等） | `go test`（checks.yml） | 无运行时重试；容错动作 = 重跑失败 job，且必须当日登记 |

预算变更规则：

- 上调任何车道的重试预算必须走 PR，且同一 PR 更新本文件的重试预算表与对应登记项。
- 重试只把偶发失败变绿，不消除登记：用例在重试预算下稳定转绿，仍须根因确认修复后才能销案。
- 前端覆盖率阈值契约在 `app/test-config/coverage.ts` factory；重试预算与覆盖率门禁相互独立，调整重试不得触碰阈值。

## CI annotation 约定

- 统一标记：`flake:<编号>`（例：`flake:FLK-001`），用于 CI 日志检索、PR 说明与 annotation。
- GitHub Actions annotation 格式：`echo "::warning::flake:FLK-001 <测试标识> 重跑/重试转绿"`。
- Playwright 车道的重试转绿可由 reporter 输出（retried/flaky 状态）识别；处置时在 PR 说明标注登记编号。
- Go 车道无运行时重试；`gh run rerun` 转绿后，执行人须当日把重跑动作回填对应登记项的处置记录。

## 活跃登记

### FLK-001 TestTokenProviderRefreshFailureRetries

| 字段 | 值 |
|---|---|
| 编号 | FLK-001 |
| 测试标识 | `edge-server/internal/hub.TestTokenProviderRefreshFailureRetries`（`edge-server/internal/hub/token_provider_test.go`） |
| 车道 | checks.yml → windows-go-test（matrix `edge-server`，windows-latest） |
| Owner | edge-server 车道维护者 |
| 首现日期 | 2026-08-25 |
| 复现命令 | `cd edge-server && go test ./internal/hub/ -run '^TestTokenProviderRefreshFailureRetries$' -count=50 -short`（压测复现；CI 全量为 `go test ./... -short -count=1 -timeout 15m`） |
| 到期复审日 | 2026-09-24 |
| 状态 | 已修复（归档） |

**现象**：2026-08-25 的 Windows CI 运行中出现一次偶发失败（`LastError` 断言为空），`gh run rerun --failed` 后转绿；同车道 Linux 运行未见复现。

**根因（静态审查确认，2026-08-28 根因修复落地）**：测试以 mock 服务端请求计数（`refreshCalls >= 1`）作为等待信号，而计数在**服务端收到请求时**即自增；被断言的 `LastError()` 由**客户端**在收到 500 响应后才写入（`token_provider.go` 的 `setLastErr("refresh status " + resp.Status)`）。两个信号之间存在时序窗口，Windows CI 调度延迟拉大该窗口时，断言先于错误记录执行，导致偶发失败。修复方向：把等待信号改为直接轮询 `LastError()` 非空（或与请求计数合取）；属测试代码变更，按车道纪律另起 PR 实施（2026-08-28 落地，见处置记录）。

**处置记录**：

| 日期 | 动作 | 结果 |
|---|---|---|
| 2026-08-25 | Windows CI 偶发红，执行 `gh run rerun --failed` | 转绿；建立本登记条目，根因静态确认，修复未落地 |
| 2026-08-28 | 根因修复：等待信号由服务端请求计数改为 testkit.Eventually 轮询客户端 LastError() 非空，消除服务端计数/客户端错误记录间的时序窗口 | 本机 Windows 压测 -count=200 零失败、internal/hub 全包 -short 全绿、go vet 干净；状态转已修复（归档） |

### FLK-002 chat-flow-contract in-flight 发送按钮偶发禁用超时

| 字段 | 值 |
|---|---|
| 编号 | FLK-002 |
| 测试标识 | `app/web/src/__e2e__/chat-flow-contract.spec.ts` › "Web shared chat flow contract › keeps a submitted Hub user message visible while the send request is in flight"（spec 第 84 行） |
| 车道 | checks.yml → `Web stubbed-hub E2E (path-filtered)`，ubuntu-latest chromium |
| Owner | Web E2E 车道维护者 |
| 首现日期 | 2026-08-25 |
| 复现命令 | `cd app/web && pnpm exec playwright test --config playwright.config.ts --project=chromium src/__e2e__/chat-flow-contract.spec.ts`（压测复现追加 `--repeat-each=30`） |
| 到期复审日 | 2026-09-24 |
| 状态 | 观察中（根因未确认） |

**现象**：2026-08-25 #1981 车道（run 32832310745）该用例在 `composer.fill` 后断言发送按钮 `toBeEnabled()`，按钮持续 `disabled` 20s 超时；同批 8 个 stubbed-hub 用例通过。同一提交本机复跑 2/2 绿，`gh run rerun --failed` 转绿。

**初步排查**：stubbed-hub 环境 `hub.test.invalid` 的 WS 重连噪音是该车道正常背景音，与禁用态无直接因果；静态审查未发现 #1981 改动（派发队列）触碰 sendability 判定路径。怀疑 CI 负载下 sendability/就绪态时序抖动，根因待本地压测复现后确认。

**处置记录**：

| 日期 | 动作 | 结果 |
|---|---|---|
| 2026-08-25 | CI 偶发红（#1981），本机复跑 2/2 绿，执行 `gh run rerun --failed` | 转绿；当日回填本登记条目，根因待压测复现 |

## 维护规则

- 新登记走 PR，编号取现有最大编号 +1。
- 每次触碰本文件时顺带巡检活跃登记：已修复的归档、已到期的移除。
- 本文件超过 300 行时拆分处置历史到归档。
