// Package opencode 收纳 AgentHub 的原生 OpenCode ACP 适配器
// OpenCodeACPAdapter（registry id "opencode-acp"）：以 `opencode acp`
// 原生子命令启动 OpenCode 二进制（v1.18.5+），封装 adapters/acp 子包共享
// ACP 运行时 AcpAdapter。
//
// 本包是 #1760「adapters 归组以降低认知负载」的 codex/opencode 增量：从根
// internal/adapters 的平铺文件中，把 opencode-acp 适配器（opencode_acp.go
// 及其测试）下沉为子包。
//
// 依赖方向（单向，无环，与 sdk/claude 子包一致）：
//
//	internal/adapters/opencode → internal/adapters/acp（共享 ACP 机制
//	AcpAdapter/NewAcpAdapterConfig/AgentBinary()，随 #1760 acp 增量归组到
//	adapters/acp）
//	internal/adapters/opencode → internal/adapters（AgentAdapter 合同仍留在
//	根包）
//	internal/adapters/opencode → internal/orchestration（合同类型 SSOT，经
//	aliases.go 引入，模式对齐 adapters/sdk、adapters/claude 与
//	adapters/orchestrator 叶子包）
//	cmd/agenthub-edge、internal/httpserver（组合根与装配点）→
//	internal/adapters/opencode
//
// 根 internal/adapters 不 import 本子包：根包对 opencode 的唯一残留引用是
// registry.go 中的字符串适配器 ID（"opencode-acp"），注册由组合根完成，
// 因此方向天然单向。AgentHubAgentSpec fixture 的 cli-json 投影需要构造
// OpenCodeACPAdapter，通过 sdk 子包 RegisterOpencodeACPadapterProvider 反向
// 注入（见 fixture_provider.go），避免 sdk import 本包形成环。
package opencode
