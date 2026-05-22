# Review 和 Git 门槛

本文件把交叉 review、验证和 git 收口规则内嵌到仓库级 skill 中。不要依赖外部 skill 是否安装。

## 1. Worktree 门槛

以下情况使用 `.worktrees/`：

- 多会话开发
- 改动跨多个模块
- 需要多个 Agent 并行写不同路径
- 当前工作区已有无关改动
- 回滚和对比成本明显

小文档改动或单文件修复可以在当前工作区完成。

创建前：

1. 同步 `master`。
2. 确认 `.worktrees/` 已被忽略。
3. 记录任务卡和写入范围。
4. 在 worktree 中运行基线检查。

## 2. Subagent 门槛

可以使用 subagent，但必须满足：

- 每个 subagent 任务自包含。
- 写入范围明确且互不重叠。
- 允许修改的路径写在提示里。
- 必读文档、验收命令、隐私红线写在提示里。
- 主 Agent 负责最终集成、验证和提交。

不要为了仪式感派 subagent。任务紧耦合时主 Agent 自己做。

## 3. 自我 Review

提交前主 Agent 必须自己看 diff：

- 是否改了未授权路径。
- 是否留下 TODO、调试输出、死代码。
- 是否破坏 API、事件名、路径或配置。
- 是否缺少测试或确定性检查。
- 是否泄露本机路径、密钥、真实服务器信息。
- 文档是否和实现一致。

自我 review 不能替代交叉 review。

## 4. 交叉 Review

非平凡改动必须做交叉 review。可以由 subagent、另一个 Agent 或主 Agent 的独立 review pass 完成。

至少覆盖这些维度：

| 维度 | 检查重点 |
|---|---|
| structure | 目录、包边界、死代码、测试缺口 |
| docs | README、AGENTS、路线图、API 文档是否同步 |
| packaging | setup、CI、脚本、依赖、构建入口 |
| usability | 新人能否按文档运行，错误信息是否可理解 |
| architecture | Hub-Edge-Runner 边界、权限、超时、隐私 |

问题分级：

| 级别 | 处理 |
|---|---|
| Critical | 本轮必须修 |
| High | 本轮优先修 |
| Medium | 可修则修，否则写入路线图 |
| Low | 只记录，不阻塞 |

## 5. 验证门槛

没有新鲜验证证据，不得声称完成。

流程：

1. 找到能证明结果的命令。
2. 运行完整命令。
3. 阅读输出和退出码。
4. 结果不通过就说真实状态。
5. 结果通过才写“通过”。

常用最小检查：

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git status --short --branch
```

Go 代码变更追加：

```powershell
go test ./...
```

前端或 Desktop 变更追加对应目录的：

```powershell
pnpm test
pnpm build
```

## 6. Git 门槛

提交前：

1. `git status --short --branch`
2. `git diff --check`
3. 检查 staged diff。
4. 不提交无关用户改动。
5. commit message 使用 `type(scope): 中文摘要`。
6. 有需要时 push 当前分支。

禁止使用会丢用户工作的命令，除非用户明确要求。

## 7. 完成门槛

一次 `set-goal` 运行结束时，至少应留下：

- 一个完成的小增量，或一个写清楚的阻塞。
- 对应路线图已更新。
- 测试或确定性检查已运行，或写清无法运行原因。
- 相关文档已同步。
- git 状态已检查。
- 适合提交时已提交。
