# Grill: AgentHub 架构与执行计划

日期：2026-05-20

## 意图

3 人团队，20 天，Vibe Coding 全流程。构建一个 IM 形态的多 Agent 协作平台（AgentHub），接入 Claude Code + Codex，支持单聊/群聊/多 Agent 调度，产物内联展示（Diff/预览/代码）。TS 前端 + Go 后端，Tauri 桌面端 P0 内置。

## 约束

- 20 天硬截止，不可延期
- 3 人全部 Vibe Coding，分工：前端 1 人 + Go 后端 1 人 + 产品/文档/测试 1 人
- Go 后端同学了解 Go 但不深，前端同学主导 UI
- 必须接入 Claude Code + Codex 真实执行，不接受 mock
- 课题考察：AI 协作 30% + 功能完整 25% + 生成效果 20% + 代码理解 15% + 创新 10%
- 参考 Kanna / CloudCLI / Claude Code Viewer，融合复刻

## 关键决策

- 决策：`D:\Code\AgentHub` 作为 monorepo，TS 前端 + Go 后端同仓。原因：项目规模适中，不需要多仓复杂度。替代方案：前后端分仓，被拒（协作复杂）。
- 决策：`protocol.ts` 先定，作为前后端接口合同。原因：防止三人并行开发后拼不上。替代方案：各自定义接口再修，被拒（集成风险）。
- 决策：分模块生成，每模块验证后再进下一步。原因：一次生成全部工程风险高。替代方案：一次生成全部再 debug，被拒。
- 决策：Go 后端（非 Node.js）。原因：后端同学有 Go 基础，Go 高性能部署叙事适合答辩。替代方案：Node.js，被拒（团队技术栈偏好）。
- 决策：用 Agent Team 分析 12 个开源仓库，产出结构化文档驱动 Codex 生成。原因：最大化 Vibe Coding 效率。替代方案：手动读代码写 prompt，被拒（太慢）。
- 决策：不写自动化测试框架，用 Playwright 录关键路径 + `go test`（Codex 写）+ Agent 对抗测试。原因：20 天不够搞 CI/CD。替代方案：全量 E2E+单元测试，被拒（过度）。
- 决策：不做复杂 CI/CD、不做 Docker 容器、不做多租户、不做插件市场、不做 Agent 市场。已确认出界。

## 浮现假设

- Codex 能生成可运行的 Go 代码（goroutine/channel/WebSocket），但三人中无人能独立 debug Go 并发 bug
- 复刻 Kanna + CloudCLI UI 作为骨架，但 Kanna 是 Bun/JS 栈，翻译到 Go 的适配成本未知
- 三人并行 Vibe Coding 的瓶颈不在代码生成速度，而在协作工作流（需求拆解、验收标准、集成拼接）
- 答辩时 Go 技术选型需要准备好叙事（高性能/轻量部署/现代并发），否则 15% 代码理解度会丢分

## 待解决问题

- Go Server 与 Kanna（Bun/JS）的架构差异多大，翻译成本多高
- 20 天后能交付的完整度到哪个级别（P0 全跑通？P1 群聊？P2 移动端？）
- 答辩时谁来回答 Go 并发实现细节

## 出界

- 多租户 / 账号系统
- 插件市场 / Agent 市场
- 复杂 DAG 编辑器
- Docker 容器 / Kubernetes
- OpenHands / Dify / ChatDev 整仓魔改
- 矩阵协议 / Element
- 完整 CI/CD 流水线
