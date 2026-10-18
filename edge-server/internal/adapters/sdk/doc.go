// Package sdk 收纳 AgentHub 的直连 HTTP「SDK 适配器」（anthropic-sdk 与
// openai-sdk）：不经过 CLI 子进程，BuildCommand 返回哨兵命令，ParseStream
// 直接发起对提供商 API 的流式 HTTP 调用并映射为 Edge 事件。
//
// 依赖方向（单向，无环）：
//
//	internal/adapters/sdk → internal/adapters（ResolveModel、CtxRunContext、
//	NewNonRecoverableParseError 等仍留在根包的助手）
//	internal/adapters/sdk → internal/orchestration（合同类型 SSOT，经
//	aliases.go 引入，模式对齐 adapters/orchestrator 叶子包）
//	cmd/agenthub-edge（组合根）→ internal/adapters/sdk
//
// 根 internal/adapters 不 import 本子包：根包仅在 registry.go 持有字符串
// 适配器 ID（"anthropic-sdk" / "openai-sdk"），注册由组合根完成，因此方向
// 天然单向。
//
// sdk_fixture_mapper、agentspec_fixture.go 与 runtime_manifest.go 同在本包；
// BusEvent* 常量经 aliases.go 派生自 orchestration，依赖方向保持
// sdk → adapters 单向。
package sdk
