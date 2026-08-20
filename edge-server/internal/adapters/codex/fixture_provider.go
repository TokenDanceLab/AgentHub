// AgentHubAgentSpec fixture 投影的 codex-acp 构造器注入（#1760 codex/opencode
// 增量）。
//
// 根包 internal/adapters 的 CompileAgentSpecV1ToRuntimeInvocationFixture 在
// runtimeID "codex" 时需要构造 CodexACPadapter 以投影 redacted CLI invocation
// plan。但根包不得 import 本包（codex → adapters 为单向依赖，与 sdk/claude
// 子包一致），否则形成 import cycle；因此本包在 init 时经根包
// RegisterCodexACPadapterProvider 反向注入构造器。
package codex

import "github.com/agenthub/edge-server/internal/adapters"

func init() {
	adapters.RegisterCodexACPadapterProvider(func() adapters.AgentAdapter {
		return NewCodexACPadapter("")
	})
}
