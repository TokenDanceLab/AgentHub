# Changelog

所有值得发布的用户可见变化、兼容性变化和 release gate 结论记录在这里。2026-06-27 前的完整历史 changelog 见 [docs/history.md](docs/history.md)。

## [Unreleased]

## v0.6.0 (2026-08-06)

- 发布门禁：版本升至 0.6.0；release 的 build-mobile 改为 `RELEASE_MOBILE_ENABLED` 门控（EAS/EXPO_TOKEN 未配置时跳过 APK，不再阻塞发布）。
- 修复 hub-server：Timeout 中间件不再包装 WebSocket upgrade 请求（此前缓冲 writer 不支持 hijack，WS 握手永久挂起）；未认证请求跳过权限审计（此前 user_id 空串导致 PostgreSQL uuid 报错污染日志）。
- 修复部署：根 `docker-compose.yml` 的 hub-server build context 改为仓库根（此前 `./hub-server` 与 Dockerfile 的 `COPY go.work/pkg/edge-server` 冲突，`docker compose up --build` 必然失败）。
- 新增 `scripts/e2e/verify-wsl-full-stack-e2e.py`：WSL 容器形态全栈 E2E（tokendance-id + hub-server + PG16 + Redis7），真实 OIDC PKCE 登录流 18 项断言 + integration 级证据 manifest（`real_tokendance_id_login=true`）。
- 测试基建：偿还 golangci-lint v2.12.2 对测试文件的 gosec G101/G306 与 staticcheck QF1008/QF1002 finding（master 基线漂移修复）。
- 修复桌面 macOS 发布链路（自 v0.5.0 起 macOS DMG 从未构建成功，v0.6.0 验证过程逐层修复）：恢复 `apple-native-keyring-store` 的 `keychain` feature（#1643）；修正 `keychain::Store` 模块路径（#1644）；macOS 构建改用 `--bundles dmg` 覆盖仅含 nsis 的 bundle targets（#1645）；应用图标 PNG 16-bit → 8-bit RGBA（#1646）；release job 放行 skipped 依赖（#1647）；`mobile-artifacts` 条件下载（#1648）。
- 上一版（v0.5.0 及更早）的完整历史见 [docs/history.md](docs/history.md)。

## 历史

| 版本范围 | 位置 |
|---|---|
| v0.1.0 - v0.5.2 longform | [docs/history.md](docs/history.md) |
| 2026-06-17 release materials | [docs/history.md](docs/history.md) |
| 已完成 spec-driven 专项 | [docs/history.md](docs/history.md) |
