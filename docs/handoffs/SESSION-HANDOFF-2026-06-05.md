# AgentHub 工程治理交接 — 2026-06-05

## 项目状态概览

- **master**: `a9d134f2`（PR #237 已 squash merge，包含文档去重/.gitignore/依赖对齐/CI 修复）
- **dev/delicious233**: 同步到 master，有 8 个文件未提交改动（sidecar/capabilities/OIDC）
- **PR #237**: 已合并 — https://github.com/TokenDanceLab/AgentHub/pull/237
- **远程分支**: `dev/johnny` 和 `dev/trump` 保留不动（其他人的开发分支）

## 一、未提交改动（WIP，需审查后提交）

工作区有 8 个 modified + 1 个 untracked 文件，来自上一轮 subagent 的产出：

### 1.1 Tauri Sidecar 配置（已完成，可提交）

| 文件 | 改动 |
|------|------|
| `app/desktop/src-tauri/tauri.conf.json` | 加了 `"externalBin": ["binaries/agenthub-edge"]` |
| `app/desktop/src-tauri/binaries/.gitkeep` | 新增，sidecar 二进制目录占位 |
| `app/desktop/src-tauri/src/edge_manager.rs` | 重构为双模式：sidecar（release）+ tokio::process（dev fallback），用 `EdgeChild` enum 包装两种子进程类型 |
| `app/desktop/src-tauri/src/lib.rs` | 加了 `.plugin(tauri_plugin_updater::Builder::new().build())` |

### 1.2 Capabilities 修复（已完成，可提交）

| 文件 | 改动 |
|------|------|
| `capabilities/default.json` | 加了 `"notification:default"` 和 `"updater:default"` 权限 |
| `gen/schemas/capabilities.json` | schema 自动更新 |

### 1.3 OIDC Server 修复（已完成，可提交）

| 文件 | 改动 |
|------|------|
| `src/oidc_server.rs` | `stop_oidc_callback_server` 从 no-op 改为设置全局 `AtomicBool`，用 `static OIDC_STOPPED` 替代 `Arc<AtomicBool>` |

### 1.4 Release 打包（已完成，可提交）

| 文件 | 改动 |
|------|------|
| `.github/workflows/release.yml` | `build-desktop` job 加了 download-artifact + copy sidecar 步骤；portable zip 加了 edge-server |
| `scripts/release.ps1` | Go build 后、Tauri build 前，拷贝 edge exe 到 `src-tauri/binaries/` 并重命名为 Tauri triple 名 |

**行动项**：审查这些改动，跑 `cargo check`（在 `app/desktop/src-tauri/`）确认编译通过，然后 commit + push 创建 PR。

---

## 二、待解决问题清单

### P0 — Release 打包（必须修）

#### 2.1 Logo 替换为正确版本

当前 Tauri 图标是从别的项目拷的占位文件。正确的 logo 在：

```
D:\Code\TokenDance\logo\final\raster\
```

需要的文件（透明底圆角版）：

| 用途 | 源文件 | 目标位置 |
|------|--------|----------|
| 32x32 icon | 需从 512px 缩放到 32x32 | `app/desktop/src-tauri/icons/32x32.png` |
| 128x128 icon | 需从 512px 缩放到 128x128 | `app/desktop/src-tauri/icons/128x128.png` |
| 128x128@2x | 需 256x256 | `app/desktop/src-tauri/icons/128x128@2x.png` |
| icon.png (512x512) | `TokenDance-icon-rounded-512.png` | `app/desktop/src-tauri/icons/icon.png` |
| icon.ico (多分辨率) | 需从 PNG 生成含 16/32/48/64/128/256 | `app/desktop/src-tauri/icons/icon.ico` |
| Mobile icon.ico | 同上 | `app/mobile/src-tauri/icons/icon.ico` |
| Web favicon | 需 192 + 512 版本 | `app/web/public/` 下的 favicon 文件 |

源文件：`TokenDance-icon-rounded-512.png`（42KB）、`TokenDance-icon-rounded-192.png`（6.7KB）

**生成 .ico 工具**：可用 `pnpm add -D png-to-ico` 或 `magick`（ImageMagick）：
```bash
# ImageMagick
magick TokenDance-icon-rounded-512.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

#### 2.2 macOS Desktop Release 缺失

`release.yml` 的 `build-desktop` 只跑 `windows-latest`。Go 二进制已经交叉编译了 darwin-amd64/arm64，但没有 macOS 的 Tauri 构建。

**需要**：加一个 `build-desktop-macos` job（matrix 或单独 job），在 `macos-latest` 上跑 `pnpm tauri build`，生成 `.dmg`。sidecar 二进制命名用 `agenthub-edge-aarch64-apple-darwin`（arm64）和 `agenthub-edge-x86_64-apple-darwin`（Intel）。

#### 2.3 Portable Zip 完整性

release.yml 的 portable zip 目前只打包了 `AgentHub.exe` + `agenthub-edge.exe` + README。但 edge-server 运行还需要 store file 路径。确认 portable 模式下 edge 的 `--store-file` 写入 `AgentHub-portable/` 目录而非 `%TEMP%`。

### P1 — Updater（需基础设施）

#### 2.4 Updater 端到端实现

当前状态：
- `tauri.conf.json` 有 updater config，`active: true`
- `lib.rs` 已加 `.plugin(tauri_plugin_updater::Builder::new().build())`
- `capabilities/default.json` 已加 `updater:default`

**缺失**：
1. **密钥对**：`pubkey` 为空字符串。需生成：`pnpm tauri signer generate -w .tauri/agenthub.key`，公钥填入 `tauri.conf.json` 的 `pubkey` 字段，私钥存 GitHub Secrets
2. **Endpoint 域名**：`https://releases.agenthub.dev/updater/...` 目前 DNS 未配置。可选方案：
   - Cloudflare Workers 做 updater endpoint
   - GitHub Releases 直接用（Tauri 支持 GitHub updater provider）
   - 静态托管到 S3/R2
3. **CI 签名**：`release.yml` 需要在 `pnpm tauri build` 后对 NSIS 安装包做 `tauri signer sign`
4. **Updater metadata**：生成 updater JSON（version, url, signature, notes），上传到 endpoint
5. **前端集成**：`app/desktop/src/` 里没有任何 `checkForUpdate` 调用。需加 UI：设置页"检查更新"按钮 + 自动后台检查

### P2 — 安全加固

#### 2.5 文件系统访问不受限

`src/commands.rs` 里 `read_file`、`write_file`、`delete_entry`、`create_file`、`create_folder`、`rename_entry`、`copy_entry` 接受任意路径，无服务端校验。`validate_allowlist` 是前端自愿调用的。

**建议**：在 Rust 命令内部强制校验路径，用 allowlist 或 app data 目录限制。

#### 2.6 OIDC Server 线程泄漏

虽然 `stop_oidc_callback_server` 已修（设置全局 AtomicBool），但 `CALLBACK_TIMEOUT_SECS = 300`（5 分钟）太长。如果用户反复取消登录，会堆积后台线程各持有 TCP 端口。

**建议**：缩短 timeout 到 60 秒，或在 `start_oidc_callback_server` 开头先调一次 stop 清理旧实例。

### P3 — 工程卫生

#### 2.7 edge_manager 的 store_path

当前 `store_path` 用 `std::env::temp_dir().join("agenthub-edge-store.json")`。Windows `%TEMP%` 可能被清理。

**建议**：改用 `app.path().app_data_dir()` + `agenthub-edge-store.json`。

#### 2.8 edge_manager 未传 --runner-profile

`edge_manager.rs` 启动 edge-server 时只传 `--store-file` 和 `--addr`，没传 `--runner-profile`。意味着 edge-server 启动后用 mock executor fallback。

**建议**：从用户设置读取默认 runner profile，或传 `--runner-profile claude-code` 作为默认值。

#### 2.9 Cargo.toml 未加 tauri-plugin-updater

`lib.rs` 加了 updater 插件初始化，但需确认 `Cargo.toml` 的 `[dependencies]` 里有 `tauri-plugin-updater = "2"`。审计说已经有了，但需 double check。

#### 2.10 依赖 peer dep 残留

`pnpm install` 报了两个 peer dep warning：
- `eslint-plugin-import` 需要 eslint ^8 但项目用 eslint 10.4.0
- `@emoji-mart/react` 需要 react ^18 但项目用 react 19.2.7

非阻塞但应关注。

---

## 三、推荐执行顺序

```
1. cargo check 验证当前 WIP 编译通过
2. 替换 Logo（生成各分辨率 PNG + ICO）
3. 提交 WIP 改动 + Logo → 创建 PR → squash merge
4. （可选）加 macOS Desktop build job
5. 生成 updater 密钥对 + 配置 GitHub Secrets
6. 实现前端 updater UI
7. 文件系统路径加固
```

## 四、关键路径参考

| 资源 | 路径 |
|------|------|
| Logo 源文件 | `D:\Code\TokenDance\logo\final\raster\TokenDance-icon-rounded-*.png` |
| Tauri 配置 | `app/desktop/src-tauri/tauri.conf.json` |
| Edge 管理 | `app/desktop/src-tauri/src/edge_manager.rs` |
| OIDC 服务 | `app/desktop/src-tauri/src/oidc_server.rs` |
| Capabilities | `app/desktop/src-tauri/capabilities/default.json` |
| Release CI | `.github/workflows/release.yml` |
| Release 脚本 | `scripts/release.ps1` |
| Edge 命令入口 | `edge-server/cmd/agenthub-edge/main.go` |
| 前端 Edge 客户端 | `app/desktop/src/api/edgeClient.ts` + `edgeAuth.ts` |
| AGENTS.md | 项目根（30KB，AI agent 指令） |

## 五、分支保护规则

- `master`：禁止 force push 和直接 push，必须通过 PR
- `dev/delicious233`：禁止 force push
- `dev/johnny`、`dev/trump`：保留不动，其他人的开发分支
- 删除远程分支需先在 GitHub Settings 取消保护

## 六、构建命令速查

```bash
# Go edge-server
cd edge-server && go build -o agenthub-edge.exe ./cmd/agenthub-edge

# Go hub-server
cd hub-server && go build -o server-hub.exe ./cmd/server-hub

# Frontend
cd app && pnpm install && pnpm dev        # 开发
cd app && pnpm build                       # 构建
cd app && pnpm test                        # 测试

# Tauri Desktop
cd app/desktop && pnpm tauri dev           # 开发模式
cd app/desktop && pnpm tauri build         # 生产构建

# Edge-server 运行
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --dev --runner-profile claude-code
```
