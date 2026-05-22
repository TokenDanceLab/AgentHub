<!--
标题格式：docs: 中文变更说明 / feat(edge): 中文变更说明 / fix(runner): 中文变更说明
正文中文为主；代码标识、路径、协议字段、命令保持英文。
如果使用 squash merge，最终 commit 标题仍按 `type(scope): 中文摘要` 改写。
-->

## 摘要

- TODO

## 关联 issue

Closes #

## 验收

- [ ] 已运行必要检查，或说明暂时无法运行的原因
- [ ] 如果改了 API，已更新 `api/openapi.yaml` 或 `api/events.md`
- [ ] 如果改了架构/分工，已同步 `README.md`、`AGENTS.md` 或三份主文档

## 检查命令

```powershell
git diff --check
git status --short --branch
```
