# 参考项目报告标准模板

每个 Tier 0-1 项目的 `projects/<name>/` 目录至少包含以下文件。
Tier 2 项目至少包含 `01-overview.md` + `02-adoption-map.md`。

---

## 文件结构

```
projects/<name>/
  00-README.md           # 本目录索引：每篇报告的主题、行数、阅读顺序
  01-overview.md         # 项目概况：定位、技术栈、架构图、核心数据
  02-architecture.md     # 架构深度：进程模型、数据流、状态机、边界处理
  03-ui-patterns.md      # UI/UX 模式（如适用）：组件树、交互状态、动画系统
  04-agent-model.md      # Agent 编排模型（如适用）：调度策略、工具调用、审批
  05-security.md         # 安全模型（如适用）：沙箱、权限、审计
  06-adoption-map.md     # AgentHub 采纳映射：每个亮点→AgentHub 具体文件/接口
```

---

## 每份报告必须包含的元素

### 01-overview.md
- [ ] 一句话定位
- [ ] 技术栈清单（语言、框架、数据库、协议）
- [ ] 架构框图（ASCII art）
- [ ] 核心数据（stars、commits、contributors、license）
- [ ] 与 AgentHub 的总体契合度评分（1-10）

### 02-architecture.md
- [ ] 进程/服务拓扑图
- [ ] 核心数据流（从用户输入到 Agent 输出的完整路径）
- [ ] 关键状态机（至少一个：Agent 生命周期 / 会话生命周期 / 工具调用生命周期）
- [ ] 边界处理：超时、重试、优雅关闭、部分失败
- [ ] 与 AgentHub 架构的对照表（组件一一对应）

### 03-ui-patterns.md（如项目有 UI）
- [ ] 组件树（顶层到叶子）
- [ ] 关键交互的状态转换（loading→empty→error→data）
- [ ] 动画/过渡系统
- [ ] 主题/色彩系统
- [ ] 无障碍（WCAG 级别）

### 04-agent-model.md（如项目有 Agent）
- [ ] Agent 类型体系
- [ ] 工具调用流程（含审批分叉）
- [ ] 多 Agent 协作机制
- [ ] 上下文管理策略
- [ ] 错误恢复机制

### 05-security.md（如项目有安全机制）
- [ ] 权限模型（RBAC/ABAC/自定义）
- [ ] 沙箱隔离级别
- [ ] 审批门控
- [ ] 审计日志

### 06-adoption-map.md
- [ ] 每个技术亮点的四要素：
  - 参考项目怎么做（源码位置 + 行号）
  - AgentHub 当前状态（缺什么）
  - 采纳方案（具体改哪个文件）
  - 优先级（P0/M3b → P2/M5+）+ 工作量估算
- [ ] 明确不采纳的项及理由
