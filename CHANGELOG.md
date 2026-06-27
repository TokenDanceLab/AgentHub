# Changelog

所有值得发布的用户可见变化、兼容性变化和 release gate 结论记录在这里。2026-06-27 前的完整历史 changelog 已归档到 [docs/archive/release/CHANGELOG-full-2026-06-27.md](docs/archive/release/CHANGELOG-full-2026-06-27.md)。

## [Unreleased]

- 当前开发基线：`dev/delicious233`。
- 当前 spec-driven 专项进度见 [docs/progress/MASTER.md](docs/progress/MASTER.md)。
- Release/merge-readiness 结论必须带真实证据等级；stub/fixture/readiness-only 不得写成真实登录、真实模型/API、packaged Desktop 或 production deploy。

## [v0.5.2] - 2026-06-25

- 合入 docs/governance、真实 E2E evidence contract、CI gate 和 Desktop/Web shared workbench 方向的集中治理。
- 统一证据等级：fixture/unit、Playwright UI、Visual QA、stubbed Hub、observed local、approved-real、backend/API、performance/leak、packaged-release。
- 保留 Desktop/Web 为当前 UI/UX 主线，Mobile 深度 UI/native 工作延后到单独任务。
- 关键边界：`AGENTS.md` 是项目规则 SSOT，`docs/progress/MASTER.md` 是当前 SPEC 进度，`docs/roadmap.md` 是总进度。

## 历史

| 版本范围 | 位置 |
|---|---|
| v0.1.0 - v0.5.2 longform | [docs/archive/release/CHANGELOG-full-2026-06-27.md](docs/archive/release/CHANGELOG-full-2026-06-27.md) |
| 2026-06-17 release materials | [docs/archive/release/2026-06-17/](docs/archive/release/2026-06-17/) |
| 已完成 spec-driven 专项 | [docs/archives/README.md](docs/archives/README.md) |
