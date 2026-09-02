# pkg/ — Go 共享包 SSOT

`hub-server` 与 `edge-server` 共享的 Go 包。独立 Go module（`pkg/go.mod`），由根 `go.work` 与两个服务联编。

## 上提规则

任何**线契约 / 安全相关 / 算法必须一致**的代码，只要 hub 和 edge 各维护一份就会分叉。治理策略（见 `../AGENTS.md` 的“项目分工和边界”与 GitHub #1679）：

1. 上提 `pkg/` 单点定义；
2. hub/edge 两侧只留 **re-export shim**；
3. 配 **characterization 测试**防止行为漂移。

不要为了"统一"抹掉合理信任边界；先确认是否真的重复，再决定上提。

## 包清单

| 包 | 职责 |
|---|---|
| `errcode/` | 错误码 + `NewTraceID` 单实现（常以别名 `sharederr` 引入），edge 侧 `internal/errcode` re-export |
| `jwtutil/` | Hub 签发 / Edge 校验的线契约：capability token、`HubSessionClaims` |
| `safego/` | `SafeGo`：panic-recovering 的 goroutine 启动器 |
| `reqlog/` | gin / net/http 请求日志中间件 + trace 辅助 |
| `testkit/` | 确定性测试 helper（`Eventually`/`WaitFor`、`oidcfixture`，见 #1550） |
| `outboundmetrics/` | 可复用出站 HTTP 指标 |
| `logmask/` | 日志脱敏 helper（机密字段统一 [REDACTED]） |
| `otelids/` | OTel trace/span ID 原语（ADR-027 配套） |
| `debug/` | 调试辅助 |

## 权威指针

- 目录地图：`../AGENTS.md` 的“根级目录地图”。
- 结构债跟踪：GitHub #1675（Go 后端聚合）。
- 具体包契约以各包内 `doc.go` / 包注释为准。
