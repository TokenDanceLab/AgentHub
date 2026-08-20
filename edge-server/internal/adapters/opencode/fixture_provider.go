// AgentHubAgentSpec fixture 投影的 opencode-acp 构造器注入（#1760
// codex/opencode 增量）。
//
// sdk 子包（agentspec_fixture.go，随 #1760 mapper 增量归组）的
// CompileAgentSpecV1ToRuntimeInvocationFixture 在 runtimeID "opencode" 时
// 需要构造 OpenCodeACPAdapter 以投影 redacted CLI invocation plan。但 sdk
// 不得 import 本包（opencode → adapters/sdk 为单向依赖），因此本包在 init
// 时经 sdk.RegisterOpencodeACPadapterProvider 反向注入构造器。
package opencode

import (
	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/sdk"
)

func init() {
	sdk.RegisterOpencodeACPadapterProvider(func() adapters.AgentAdapter {
		return NewOpenCodeACPAdapter("")
	})
}
