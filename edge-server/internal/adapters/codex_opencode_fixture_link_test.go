package adapters_test

// Blank-import link for the codex/opencode fixture providers（#1760
// codex/opencode 增量）。根包 unit test（sdk_fixture_mapper_test.go 等以
// "codex"/"opencode" runtime 投影 CLI invocation plan 的测试）需要子包构造器
// 可用；根包内部测试文件（package adapters）不得 import 子包（子包 →
// adapters 单向依赖，否则 import cycle not allowed in test），故以外部测试
// 包（package adapters_test）blank import 两个子包，其 init 在同一测试二进制
// 内经 RegisterCodexACPadapterProvider / RegisterOpencodeACPadapterProvider
// 反向注入构造器。
import (
	_ "github.com/agenthub/edge-server/internal/adapters/codex"
	_ "github.com/agenthub/edge-server/internal/adapters/opencode"
)
