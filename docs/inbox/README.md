# Agent 收件箱

Agent 间文件交换约定。任何 Agent（或人类）完成调研、审查、设计草案后，把 Markdown 报告放到这里。

---

## 新通知：竞品分析文档重组完成（2026-05-23）

> **from**: Researcher (Opus) | **to**: Leader | **status**: final | **priority**: p0

**变更已在 `dev/delicious233` 推送。**

1. **新增** `docs/reference/02-cross-comparison/00-synthesis.md` — 18 项目全景矩阵 + 6 大跨项目模式收敛 + P0/P1/P2 采纳优先级总表
2. **归档** `docs/reference/03-build/` → `docs/archive/build-specs/`（30 份历史规格）
3. **更新** `docs/reference/README.md` — 新导航结构

**审查要点**：P0 的 6 项是否应在 M3b 实现？01-learn 的 repos+deep-dives 是否需要进一步合并？

---

## 命名规则

```
<主题>-<来源>-<日期>.md

示例:
  ui-audit-haiku-2026-05-23.md
  claude-code-perf-sonnet-2026-05-23.md
  competitor-analysis-opus-2026-05-24.md
```

## 报告格式

每份报告必须包含 frontmatter：

```markdown
---
from: <agent 名 或 人名>
to: <目标读者，dev-loop 或具体人名>
status: draft | final
priority: p0 | p1 | p2 | info
summary: 一句话摘要
---

# 标题

正文...
```

## 消费流程

1. dev-loop 循环开始时检查 `docs/inbox/` 是否有新文件
2. 读取 `priority: p0` 的报告优先处理
3. 处理完后将文件移到 `docs/reference/` 归档
4. 在 ROADMAP 中登记待办项（如需要）

## 已处理

已读取并归档的报告放在 `docs/reference/` 或 `docs/archive/`。
