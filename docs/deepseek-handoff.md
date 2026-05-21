# DeepSeek 文档中文化交接

日期：2026-05-21

这份文档是给 DeepSeek 或其他低成本模型的直接任务入口。目标不是重新设计架构，而是把 AgentHub 自有文档按统一规则中文化、校对和补导航。

## 任务目标

把 AgentHub 自有文档逐步改成中文可读版本，保留代码、协议、路径和第三方项目名的英文写法。

完整路线图：`docs/chinese-documentation-roadmap.md`

语言规则：`docs/language-policy.md`

术语表：`docs/glossary.md`

## 处理范围

需要处理：

- `docs/*.md`
- `docs/research/*.md`
- `docs/reference/**/*.md`
- `services/*/README.md`
- `packages/*/README.md`

不要处理：

- `reference/**` 下 clone 回来的第三方仓库
- 代码文件、生成文件、锁文件
- Protobuf message、field、enum、service 名
- Go package、TypeScript package、API method、JSON key、CLI 命令

## 执行顺序

1. 先读 `docs/language-policy.md` 和 `docs/glossary.md`。
2. 再按 `docs/chinese-documentation-roadmap.md` 的 P0-P5 批次执行。
3. 每次只处理一个批次或一个清晰目录，避免大范围低质量机械翻译。
4. 每批完成后更新相关入口，例如 `README.md`、`AGENTS.md` 或 `docs/reference/README.md`。

## 翻译提示词

```text
你正在处理 AgentHub 自有技术文档中文化。

要求：
1. 输出中文技术文档，不要写翻译说明。
2. 保留 markdown 结构、标题层级、表格、链接和代码块。
3. 不翻译代码块、路径、命令、Protobuf 字段、API method、JSON key、Go/TS package 名。
4. 第三方项目名保留英文，例如 Multica、Ruflo、Codex、OpenHands。
5. 遇到不易懂的英文缩写，改成中文白话，例如“唯一协议源头”。
6. 不新增“我们的决策过程”之类聊天式内容，只保留结论、规则、结构和接口。
7. 如果发现旧链接、断链、术语冲突或不确定内容，保留 TODO 并说明原因。
```

## 验收命令

```powershell
git diff --check
git status --short --branch
Select-String -Path .\README.md,.\README_EN.md,.\AGENTS.md,.\docs\*.md,.\docs\reference\README.md -Pattern ('README_Z' + 'H')
```

## 人工抽查重点

- 链接没有被翻译坏。
- 代码块和命令没有被翻译。
- Hub Server、Edge Server、Runner、AgentRun、Artifact 等核心术语没有乱改。
- 没有新增“本文将介绍”“综上所述”之类空话。
- 没有修改 `reference/**` 第三方仓库内容。
