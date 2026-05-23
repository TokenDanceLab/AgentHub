---
name: cross-review
description: 代码交叉审查 — 调度多个 subagent 从不同视角审查代码变更，汇总问题清单，不写代码只出审查报告。
---

# Cross Review

用 subagent 模拟多角色交叉审查。不自己审查，而是调度专门做审查的 agent 并行跑，最后汇总。

## 触发时机

- 用户说 `/cross-review`、`交叉审查`、`review 一下`、`看看有没有问题`
- 完成一个有意义的代码变更后，push 前
- ROADMAP 要求 review 时

## 审查流程

### Step 1: 确定审查范围

```powershell
git diff --name-only HEAD~1  # 或指定 base ref
```

### Step 2: 根据文件类型分配审查角色

| 角色 | 关注点 | 适用文件 |
|------|--------|---------|
| **安全审查** | 注入、权限、密钥泄露、路径遍历 | 所有文件 |
| **架构审查** | 接口设计、包依赖、循环依赖、抽象层次 | Go 文件 |
| **测试审查** | 测试覆盖边界、错误路径、mock 合理性 | `*_test.*`、测试文件 |
| **前端审查** | 组件设计、状态管理、a11y、响应式 | `.tsx`、`.ts`、`.css` |
| **协议审查** | API 兼容性、事件 schema、向后兼容 | `api/`、`events.md`、`.yaml` |

### Step 3: 并行启动审查 subagent

对每个角色启动一个 subagent，用 HAICU（快速模式）审查：

```
Agent({
  subagent_type: "Explore",
  model: "haiku",           # 快速代码模型
  description: "安全审查",
  prompt: """
  审查以下文件的安全问题：[files...]
  只报告问题，不修代码。
  重点关注：命令注入、路径遍历、密钥泄露、认证绕过、未验证输入。
  """
})
```

所有审查 agent 同时启动，不用等。

### Step 4: 汇总报告

收集所有 subagent 返回结果，按严重度排序：

```
## Cross Review 报告

### 🔴 Critical
- [file:line] 问题描述 → 建议修复

### 🟡 Warning
- [file:line] 问题描述 → 建议修复

### 🔵 Info
- [file:line] 问题描述 → 建议修复

### ✅ 通过
- 安全审查：无问题
- 架构审查：...
```

### Step 5: 提交前验证

所有 Critical 和 Warning 必须在提交前修复或记录为技术债。

## 审查规则

- subagent 只读，不写代码
- 每个 subagent 只审查自己角色的关注点
- 主 Agent 负责汇总和判断优先级
- 审查结果写进 ROADMAP 或 PR 描述
- 不阻塞 P0 进度：Critical 必须修，Warning 可记录为 follow-up
