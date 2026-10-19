# AgentHub Governance

最后更新：2026-10-18

本目录维护工程门禁清单。

| 文件 | 内容 |
|---|---|
| [verifier-map.md](verifier-map.md) | 规则 → 机器验证映射（SSOT，被 `scripts/verify/verify-doc-ssot.py` 机器校验） |

## 维护规则

- 新的机器门禁进 `verifier-map.md`，不写回 `AGENTS.md` 长表。
- 安全策略与支持范围以 [SECURITY.md](../../SECURITY.md) 为准。
- 本目录文档必须能在 standalone clone 中自洽，不引用仓库外的文件。
