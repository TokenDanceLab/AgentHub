# Reference

技术参考、cc-switch 集成文档、设计系统报告、运维 SOP 和活跃参考项目调研。

> **已归档**：竞品分析、研究综合报告、已完成的项目调研已移至 `docs/archive/`。
> 详见 `archive/competitor-research/` 和 `archive/reference-projects/`。

## 目录结构

```
reference/
├── README.md                        # 本文件
├── agenthub-agent-spec.example.json # Agent 规格示例
├── ai-desktop-ux-patterns.md        # AI Desktop UX 模式研究
├── cc-switch-integration-design.md  # cc-switch 集成设计
├── cc-switch-provider-model-ref.md  # cc-switch Provider/Model 参考
├── cc-switch-storage.md             # cc-switch 存储设计
├── design-systems-master-report.md  # 设计系统综合报告
├── desktop-architecture-alignment.md # Desktop 架构对齐分析
├── desktop-ui-qa-sop.md             # Desktop UI QA SOP（运维操作规程）
├── sdk-agent-strategy.md            # SDK Agent 策略
└── projects/                        # 5 个活跃参考项目深度调研
    ├── aionui/                      # aionui (10 篇)
    ├── kanna/                       # Kanna (5 篇)
    ├── librechat/                   # LibreChat (4 篇)
    ├── open-design/                 # open-design (3 篇)
    └── opencode/                    # OpenCode (4 篇)
```

## 说明

- cc-switch 集成文档（`cc-switch-*.md`）是当前生产系统的参考，需与 `server/` 仓库保持同步。
- `desktop-ui-qa-sop.md` 是活跃的 QA 操作规范，持续维护。
- `design-systems-master-report.md` 和 `desktop-architecture-alignment.md` 是进行中的设计/架构参考。
- 项目调研（`projects/`）聚焦正在进行的设计参考，已完成的竞品研究已归档至 `archive/`。
- 所有文档仅供参考，不代表当前实现。
