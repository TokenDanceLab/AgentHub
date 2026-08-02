# PROGRESS.md — TODO 清理 + skip 抽查（任务书 J）

- 开工：2026-08-02，worktree chore/todo-cleanup @ 830801a1
- 基线：edge-server TODO/FIXME 19 处；app/shared 20 处；测试 skip：go 25 + app 15（Playwright test.skip 14 + describe.skip 1）
- 完成：见 PR（squash merge 后更新）

## TODO 处理统计（39 处）
- 过时删除（a 类）8 处：pinMap 落地（pinMap.ts:1 / normalizeHubMessages.ts:51,73 / mappers.ts:510）、P6 Step3 闭环（DiffReviewPanelHelpers.ts:64 / DiffReviewPanelTypes.ts:39）、unpinMenu 已实现（resources.ts:277,783）
- ACP 补 #1404（b 类）12 处：acp.go:153、acp_client.go:35,251,266,296,312,332,357,366、claude_acp.go:123、codex_acp.go:133、opencode_acp.go:130（#1404 OPEN，ACP spike 增量采纳）
- 建 issue 并补号（c 类）12 处 → 8 个 issue：a11y 审批卡播报 #1503（RowItem:394）、copyLink #1504（mappers:110/labels:133）、word-diff 阈值 #1505（diffWordTokens:51）、Markdown 锚点 #1506（Markdown:96）、Tooltip 真机验证 #1507（Tooltip.test:191-195 ×3）、会话操作 #1508（ConversationSidebar:229）、HC 玻璃面板 #1509（tokens-base.css:586 + prismRegistry.test:13 引用）、数据层分页 #1510（ContactMainParts:70/TaskMainViews:110）
- 纯信息保留（d 类）："See ReadTextFile for the TODO" 等引用注释 ×5、claude_code.go:10 引用 —— 指向已带号主 TODO
- 剩余 30 处 TODO 全部带 issue 号（#1404/#1503-#1510），可追踪性 100%

## skip 抽查统计（40 处，全部判定为环境门，合理保留）
### go（25 处）
- short mode 门 ×9：claude_adapter_integration_test.go:18、opencode_adapter_integration_test.go:17、hub_e2e_test.go:203,293,459,503、hub_integration_test.go:317,446、orchestrator_extract_preflight_test.go:102 中 goimports 未装 —— message 均说明原因
- binary/工具缺失 ×2：claude:25、opencode:24（CLAUDE_PATH/OPENCODE_PATH 提示）
- SSH host 门 ×2：deploy_ssh_test.go:21,25（-ssh-integration flag）
- symlink 不可用 ×4：handlers_test.go:1104、mcp/server_test.go:1234、security/path_test.go:108,126
- cc-switch db 门 ×3：ccswitch/reader_test.go:19,32,60
- Windows 平台门 ×2：env_behavior_test.go:426（大小写不敏感）、env_sanitizer_test.go:174
- 环境取件失败 ×2：evidence_gate_test.go:442,451（cwd/go.mod 不可得）
- 其他 ×1：claude_adapter_integration_test.go:93（AGENTS.md 缺失）
### app（15 处）
- Edge 进程状态门 ×10：events.spec.ts:13,23,31,42、health.spec.ts:8,17,27,37,45,59 —— 条件式 test.skip(online/!online)
- Go 环境门 ×1：edge-real.test.ts:58-59（HAS_GO ? describe : describe.skip）
- Web dev server 探测门 ×3：chat-real.spec.ts:541,564,641 —— try 探测 127.0.0.1:5174，catch 才 skip(true)，非无条件跳过
- 真实登录环境门 ×1：oidc-login.spec.ts:687（显式 env 批准 + 一次性账号）
### 上报：0（无无理由 skip、无 "known failure" 式藏失败、无 .skip() 放松断言）

## 验证
- edge-server: go test ./internal/adapters/ -short（ACP 相关改动）全绿；gofmt/vet 干净
- app/shared: vitest 受影响文件全绿（57 + 124 + 后续全量）
