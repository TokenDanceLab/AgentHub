# AgentHub v0.4.0 Roadmap

> 2026-06-10 · 基于 v0.3.0-rc.9 完成报告
> 上一版本详细 roadmap 已归档至 `docs/archive/roadmap-v0.3.0/`

---

## 0. 基线

| 维度 | v0.3.0 交付 |
|------|------------|
| IM 功能 | 13/13 ✅ |
| 右侧栏预览 | 14/14 ✅ |
| 管线代码 | 12/12 (8 done + 4 code-written) |
| 一键部署 | ✅ `*.pages.vectorcontrol.tech` |
| hk2 生产 | ✅ Hub Docker + Edge systemd |
| Desktop/Mobile/Web | ✅ 三端皆通 |
| 测试 | 41/41 Go · 0 TS errors · 88/88 Gate |
| APK | ✅ Release arm64-v8a 29.83 MB (2026-06-10) |

---

## 1. v0.4.0 主线目标

### P0: 运行验证（代码已写，需要跑起来）

| # | 项目 | 内容 |
|---|------|------|
| 1 | **Orchestrator 端到端** | 4 个 Go 文件在真实 Edge + 多 Agent 任务中跑通 |
| 2 | **RunEvent replay** | 前端断线重连增量补齐闭环 |
| 3 | **Surfacing 自动升格** | Agent 写文件 → 聊天流内联预览卡片全流程 |
| 4 | **@Agent E2E** | Web OIDC 登录 → 群聊 @Agent → Hub dispatch → Edge → CC CLI → transcript 渲染 |

### P1: 功能补全

| # | 项目 | 内容 |
|---|------|------|
| 5 | **对话式创建 Agent** | 比赛要求"对话式创建"——当前只有表单版 |
| 6 | ~~**Android APK 构建**~~ ✅ | Release arm64-v8a 29.83 MB (2026-06-10) |
| 7 | **OIDC 全链路验证** | TokenDance ID → Hub → JWT → WS 完整重验 |
| 8 | **演示材料** | 3-5 支视频 + 5-7 张截图 |

### P2: 优化

| # | 项目 | 内容 |
|---|------|------|
| 9 | **cc-switch 模型可视化** | Agent 配置页显示真实模型别名 |
| 10 | **Settings 完善** | preferences 跨端同步 |
| 11 | **性能** | Edge event store 压缩、Hub WS 连接池 |
| 12 | **文档** | API 参考文档、部署手册 |

---

## 2. 不做（明确排除）

- macOS 签名/公证 — 缺硬件
- iOS 端 — 缺设备 + 证书
- 力导向 DAG 图 — `<ul>` tree 够用
- Matrix 协议 — 架构选择差异
- 竞品再审计 — 窗口已关

---

## 3. 里程碑

| Milestone | 内容 | 目标日期 |
|-----------|------|----------|
| M1: 全链路通 | Orchestrator E2E + @Agent E2E + replay + surfacing | TBD |
| M2: 比赛交付 | 对话式创建 + OIDC + 演示材料 | TBD |
| M3: v0.4.0-rc1 | 命令余项 + ~~APK~~ ✅ + 文档 | TBD |
