# Desktop 打包签名与原子发布方案

> 状态: SPEC merged（2026-08 管理员批准）
> 创建: 2026-07-27
> Issue: [#1403](https://github.com/TokenDanceLab/AgentHub/issues/1403)
> 输入: Codeg 发布链竞品拆解（原始调研文件已随 2026-08 本机清理删除，见 git 历史）
> 上下文: roadmap P1「Desktop packaged boundary」+ P2「Release hardening」长期挂起项；AH-SR-035/036 deploy/client 证据显式 defer

---

## 0. 动机与现状速览

AgentHub 发布链现状一句话：**有 CI 构建、有 GitHub Release、有 updater 配置声明，但没有一条完整闭环的信任链。**

- 线上最新 release（v0.5.0）只有 3 个资产（NSIS setup、portable zip、Go server exe），**无 `latest.json`、无 `.sig`**——`tauri.conf.json` 里固定的 updater endpoint 实际 404，内置自动更新从未真正工作。
- 存在 3 条互不一致的发布入口（release.yml tag 触发、cd-desktop.yml 手动触发、scripts/release/release.ps1 本地构建直传），v0.5.0 资产命名与当前 CI 约定不一致，证实入口漂移。**2026-08-02 已收敛**：cd-desktop.yml 与 release.ps1 已删除，唯一入口 = git tag → release.yml（AGENTS.md §12）。
- release.yml 无 tag 守卫（master 祖先 / 版本一致），updater 工件收集为 if-present 软放行，缺失时静默发布无更新通道的 release。**2026-08-02 已补 tag-guard job**（master 祖先 + 版本格式双断言）。
- macOS DMG unsigned + 无 darwin updater 通道；Windows 无 Authenticode 签名（SmartScreen 告警）。
- 治理面已做好边界标记：`release-readiness.yml` 将签名/公证/stapling/GitHub Release upload 全部标为 later approval slice，dry gate 体系完整——但生产发布仍是旧链。

**本方案不是空想设计**——Codeg（github.com/xintaofei/codeg）提供了一份经过 162 个 tag 实战验证的完整发布链参考实现，以下逐点对标并给出 AgentHub 适配路线。

---

## 1. 现状差距表：AgentHub vs Codeg 发布链逐项比对

| 维度 | Codeg（目标态） | AgentHub（现状） | Gap |
|---|---|---|---|
| **版本 SSOT** | `tauri.conf.json` 为唯一校验源，CI 强校验 tag 与 version 一致 | 至少 5 处版本源（见 2.2 节）无一致性校验，仅 `verify-tauri-package-readiness.py` 做静态版本对齐检查 | **无 CI 端 tag-version 校验** |
| **tag 守卫** | tag 必须在 main 祖先链 + tag = `tauri.conf.json` version，双断言 | 无任何 tag 守卫；`release.yml` push tags 触发，不校验 tag 与分支关系 | **缺**（双断言） |
| **原子发布** | draft → 11 平台并行构建 → 仅全绿才翻正式 release，幂等可重跑 | `draft: false` 直接出正式 release；一个平台失败不阻断另两个 | **缺**（draft-flip 模式） |
| **macOS 签名+公证** | Developer ID 证书 + 临时 keychain + notarytool + stapler + always() 清理，全自动 | DMG unsigned；`release-readiness.yml` 将 macOS 签名/公证标记为 later approval slice | **缺**（secrets + workflow） |
| **Windows 签名** | 无 Authenticode（有意缺） | 无 Authenticode；NSIS installer 命名含 `-setup` 但无签名；未来可选 EV/OV | **同等（都缺）** |
| **minisign 工件签名** | `TAURI_SIGNING_PRIVATE_KEY` 对所有 tarball/zip 出 `.sig` + `.sha256`，服务器自更新验签 | `TAURI_SIGNING_PRIVATE_KEY` 已配置在 release.yml，但 if-present 软收集 `.sig` 且线上 release 无 `.sig` 资产 | **已配置未生效** |
| **updater 通道** | `releases/latest/download/latest.json` 带 minisig 签名，桌面 + server 同源 | `tauri.conf.json` 已声明 endpoint 与 pubkey，但线上 latest.json 404；CD 不产出 latest.json | **配置了就位但未产出** |
| **平台矩阵** | macOS x64+arm64, Linux x64+arm64, Windows x64+arm64（6 target 桌面）+ 5 server target + docker 双 arch | Windows x64 NSIS + macOS arm64 DMG + Go server Linux x64 4 target，无 Linux 桌面 | **缺 Linux 桌面 + darwin/windows arm64** |
| **Docker 发布** | buildx 多架构 manifest，ghcr.io + Docker Hub 带版本+latest tag | 无 Docker 发布 workflow（docker-compose.yml 仅本地开发） | **缺**（非本次范围） |
| **安装脚本** | install.sh (18KB) + install.ps1 (14KB)，一行安装、PATH 冲突清理、幂等自愈、装后实解析验证 | 无安装脚本；当前分发形态 = GitHub Release 直下 NSIS setup.exe | **缺**（P2 可选） |
| **自更新+回滚** | 桌面 tauri-updater；服务器原地自更新含 minisign 验签 + .bak 回滚 + 30s 试用窗口 | 无（tauri-updater 已集成但 latest.json 404） | **缺**（服务器自更新不在本次范围） |
| **Changelog** | 双语 release notes 写在 tag commit message，CI 提取为 release body | `generate_release_notes: true` 用 GitHub 自动生成 | **功能对等**（风格不同） |
| **dry/preflight gate** | 无独立 dry gate（直接靠 CI 的 cancel-in-progress 幂等） | `release-readiness.yml` + `verify-tauri-package-readiness.py` + `verify-release-gate.py` 三层治理面 | **AgentHub 更精细**（保留，本次不删） |

---

## 2. 原子发布改造：draft-flip 模式

### 2.1 当前问题

`release.yml` 直接 `draft: false`，所有 platform job 构建完就出正式 release。一个平台失败（如 macOS 构建断网）不阻断另两个，用户看到不全的 release。Codeg 的解法：

1. tag 触发后**先创建 draft**（不公开可见）
2. 全部 N 个 platform job 并行构建+签名+上传
3. 仅当全部 success 才把 draft 翻成正式 release

### 2.2 版本源统一（关键前置）

当前 AgentHub 至少存在以下版本源：

| # | 位置 | 当前值 | 角色 |
|---|---|---|---|
| 1 | `app/desktop/package.json` | `0.6.0` | 前端 npm 版本 |
| 2 | `app/desktop/src-tauri/tauri.conf.json` | `0.6.0` | Tauri 应用版本（打包+updater） |
| 3 | `app/desktop/src-tauri/Cargo.toml` | `0.6.0` | Rust crate 版本 |
| 4 | `app/desktop/src-tauri/Cargo.lock` | `0.6.0` | crate lock 版本 |
| 5 | `app/package.json` | `0.6.0` | monorepo 根版本 |
| 6 | `app/web/package.json` | `0.6.0` | Web 前端版本 |
| 7 | `app/shared/package.json` | `0.6.0` | 共享库版本 |

**设计决定**：不引入新的版本源文件。以 `app/desktop/src-tauri/tauri.conf.json` 为版本 SSOT（与 Tauri updater 语义一致，与 Codeg 对齐），其他源跟随。

**CI 守卫逻辑**（在 draft-release step 前）：

```
1. git merge-base --is-ancestor <tag_commit> origin/master || FAIL("tag 不在 master 祖先链")
2. TAG_VERSION = strip_prefix("v", github.ref_name)
3. PKG_VERSION = read(app/desktop/package.json).version
4. TAURI_VERSION = read(tauri.conf.json).version
5. CARGO_VERSION = read(Cargo.toml).version
6. TAG_VERSION == TAURI_VERSION == PKG_VERSION == CARGO_VERSION || FAIL("版本不一致")
7. if TAG_VERSION contains '-' → prerelease=true（与现有 contains(github.ref_name, '-') 逻辑一致）
```

### 2.3 原子发布 workflow DAG（目标态）

```
tag push v*.*.*
  │
  ▼
create-draft-release         ← tag 守卫（main 祖先 + 版本一致）
  │
  ├── build-tauri-windows
  ├── build-tauri-macos
  ├── (build-tauri-linux)    ← 暂缺，本次不实现
  ├── build-server-go
  └── build-mobile
  │
  all success? ──no──► keep draft, fail workflow
  │ yes
  ▼
publish-release              ← update draft → published
  │
  ▼
upload updater metadata       ← 上传 latest.json + .sig 到 release assets
```

`build-server-go` 现有 7 target，`build-mobile` 现有 APK 路径——不需改，它们已经是现有矩阵的非桌面部分。

### 2.4 draft 幂等性

`create-draft-release` 必须幂等——支持 workflow 重跑（Codeg 也是 powerShell 脚本 112-160 行做同名 check）：

- 如果该 tag 的 release 已是 draft → 复用并更新 body
- 如果该 tag 的 release 已是正式 → fail（不能覆盖已发布版本）
- 如果该 tag 尚无 release → 创建 draft

---

## 3. 签名矩阵

### 3.1 总览

| 平台 | 当前状态 | 目标 | 前置条件 | 需要的 Secrets |
|---|---|---|---|---|
| **Windows** | 无 Authenticode | 可选：EV Code Signing 消除 SmartScreen 告警 | EV 证书购买（约 $300-500/年）或 OV 证书（$120-200/年） | `WINDOWS_CERT_BASE64`, `WINDOWS_CERT_PASSWORD` |
| **macOS** | unsigned DMG | **必须**：Developer ID Application + notarytool 公证 | Apple Developer Program $99/年 | `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_DEVELOPER_ID_CERT_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_KEYCHAIN_PASSWORD` |
| **Linux** | 无构建 | P2 暂无 | 无签名惯例 | 无 |
| **全平台 updater** | minisign 已配置未产出 | **必须**：所有安装资产出 `.sig` | 已有 `TAURI_SIGNING_PRIVATE_KEY`（需确认 CI secrets 存在） | `TAURI_SIGNING_PRIVATE_KEY` |

### 3.2 macOS 签名+公证三件套（优先实现）

这是 AgentHub 当前最大的签名缺口。Codeg 提供完整样板（release.yml:330-566 行），三步骤：

1. **导入 Developer ID 证书到临时 keychain**
   - `security create-keychain -p <password> build.keychain`
   - `security unlock-keychain -p <password> build.keychain`
   - decode `APPLE_DEVELOPER_ID_CERT_BASE64` → `.p12` → `security import .p12 -k build.keychain -P <cert_password> -T $(which codesign)`
   - `security set-keychain-settings -lut 21600 build.keychain`
2. **tauri-action 构建时配置 APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID 自动触发 notarytool 公证**
3. **always() 清理段**：恢复原 keychain 搜索列表 → 删除临时 keychain

**管理员需提供**：
- Apple Developer Program 会员（$99/年），已有 TokenDance ID Apple 账户可复用
- 在 developer.apple.com 创建 "Developer ID Application" 证书，导出为 `.p12`（带密码）
- 生成 App-Specific Password 用于 notarytool（appleid.apple.com → App-Specific Passwords）
- 获取 Team ID（developer.apple.com → Membership）

**CI Secrets 清单**（统一命名空间 `AGENTHUB_*`）：

| Secret Name | 获取方式 | 敏感度 |
|---|---|---|
| `AGENTHUB_APPLE_ID` | Apple ID 邮箱 | 高 |
| `AGENTHUB_APPLE_PASSWORD` | app-specific password（非主密码） | **极高** |
| `AGENTHUB_APPLE_TEAM_ID` | developer.apple.com → Membership | 中 |
| `AGENTHUB_APPLE_DEVELOPER_ID_CERT_BASE64` | `.p12` → `base64 -i cert.p12 \| tr -d '\n'` | **极高** |
| `AGENTHUB_APPLE_CERT_PASSWORD` | 导出 .p12 时设置的密码 | 高 |
| `AGENTHUB_KEYCHAIN_PASSWORD` | 临时 keychain 随机生成（可选，也可每次随机） | 低 |

**无 secret 降级路径**（Phase 1 实现）：macOS DMG 维持 unsigned，在 release notes 明示 "macOS build is unsigned — allow in System Settings > Privacy & Security on first launch"。此路径已通过 `macOS unsigned dry policy` 工做治理记录。

### 3.3 Windows Authenticode 签名（可选 P2）

Codeg 明确没有做 Windows 签名（SmartScreen 告警），并非疏忽而是优先级判断：minisign 保护更新通道完整性，OS 层签名保护首装信任，两者可分期。

| 选项 | 价格量级 | SmartScreen 效果 | 适用场景 |
|---|---|---|---|
| **EV Code Signing** | $300-500/年 | 即刻消除 SmartScreen 告警 | 有大量 Windows 用户的商业产品 |
| **OV Code Signing** | $120-200/年 | 积累一定下载量后消除告警 | 小规模分发，预算有限 |
| **无签名** | $0 | 首装 SmartScreen "Windows 保护你的电脑" 全屏告警 | 内部工具或用户极少 |

**建议**：Phase 1-2 不采购。当 Windows 用户量到达阈值（如月活跃 > 500）时再评估 OV/EV。发布的 NSIS 安装包已可在 release 页面下载，用户需手动点击 "仍要运行"。

### 3.4 minisign 密钥保管

`TAURI_SIGNING_PRIVATE_KEY` 已在：
- `release.yml:96` (build-desktop job env)
- `release.yml:191` (build-desktop-macos job env)
- `cd-desktop.yml:59` (build-desktop-windows job env)

需确认 GitHub Actions secrets 中该值实际存在且正确。验证方法：
```powershell
# 在本地用 tauri signer generate 生成密钥对
pnpm tauri signer generate -w ~/.tauri/agenthub-minisign
# 公钥输出 → tauri.conf.json plugins.updater.pubkey（当前已配置）
# 私钥 → 设为 GitHub secret TAURI_SIGNING_PRIVATE_KEY
```

**关键安全提醒**：`TAURI_SIGNING_PRIVATE_KEY` 一旦泄露，攻击者可签发任意 `latest.json`，令所有已安装客户端的自动更新通道被劫持。需：
- 只在 CI secrets 和本地安全环境存在
- 不在任何文档、日志、issue 中明文出现
- 轮换需同时更新 `tauri.conf.json` 中的 pubkey 并发布补丁版本

---

## 4. Tauri updater 通道

### 4.1 当前配置 vs 实际状态

`tauri.conf.json` 已声明：
```json
"updater": {
  "active": true,
  "endpoints": ["https://github.com/TokenDanceLab/AgentHub/releases/latest/download/latest.json"],
  "pubkey": "dW50cnVzdGVk...",
  "windows": { "installMode": "passive" }
}
```

**实际线上**：`latest.json` 404，自动更新从未工作。

### 4.2 latest.json 多平台聚合

Tauri updater 的 `latest.json` 按平台分发，一个 `latest.json` 可包含多平台签名与 URL。Codeg 版的关键字段：

```json
{
  "version": "0.6.0",
  "notes": "Release notes...",
  "pub_date": "2026-07-27T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<minisig signature of .exe>",
      "url": "https://github.com/.../AgentHub_0.6.0_x64-setup.exe"
    },
    "darwin-x86_64": {
      "signature": "<minisig signature of .dmg>",
      "url": "https://github.com/.../AgentHub_0.6.0_x64.dmg"
    },
    "darwin-aarch64": {
      "signature": "<minisig signature of .dmg>",
      "url": "https://github.com/.../AgentHub_0.6.0_aarch64.dmg"
    }
  }
}
```

**生成方式**：Tauri CLI (`pnpm tauri build`) 已内置 `latest.json` 与 `.sig` 生成——`cd-desktop.yml:120-123` 和 `release.yml:144-147` 的 if-present 收集逻辑证实产物会出现在 `target/release/bundle/` 下。问题不在生成，而在**上传到 release assets 并保持命名约定**。

**托管位置**：GitHub Releases 的标准 latest 重定向 `releases/latest/download/latest.json`。Tauri updater 的 endpoint 已指向此处。只需确保 release assets 里包含 `latest.json`（命名为不加版本号的固定名称，overwrite 上一版）。

### 4.3 回滚策略评估

Codeg 的回滚模型（`.bak` + exit 86 + 30s 试用窗口 + supervisor 重拉）是为**服务器二进制原地自更新**设计的，桌面端不走此路。

Tauri updater **内置语义**：
- **下载-验证-安装三阶段**：先下载新 installer → minisign 验签 → 调用 NSIS 静默安装（`installMode: passive`）
- **回滚能力**：Tauri updater 本身不提供回滚机制。如果新版启动即 crash，用户需手动从 GitHub Releases 下载旧版重新安装
- **NSIS 版本检查**：当前 tauri.conf.json 未配置 `windows.nsis.minimumWebView2Version` 等兼容性检查

**对 AgentHub 的建议**：
- **桌面端不做自动回滚**（Tauri updater 不具备此能力，Codeg 也没做）
- **版本兼容性检查**：在新版发布前，通过 `release-readiness.yml` 的 installer smoke 验证 NSIS 安装/卸载路径畅通
- **sidecar 锁风险**：NSIS 升级时若 `agenthub-edge.exe` 仍在运行，`CopyFile` 会因 Windows 写锁失败。Codeg 的 NSIS 钩子 (`installer-hooks.nsh:1-25`) 用 `taskkill /F /T /IM agenthub-edge.exe` 在安装前杀孤儿伴生进程。AgentHub 当前的 NSIS 没有自定义钩子，需在 `tauri.conf.json` 的 `windows.nsis` 增加 `installerHooks` 路径。

### 4.4 darwin updater 通道

当前 `tauri.conf.json` 只声明了一个 endpoint 但无平台区分逻辑。对于 macOS，Tauri updater 同样使用同一个 `latest.json`，但 installer 格式不同（DMG 而非 NSIS）。macOS 端需在 `tauri.conf.json` 的 `plugins.updater` 中补充 darwin 配置。DMG 对更新支持较差——需评估是否需切换到 `.app.tar.gz` 格式以便 Tauri updater 工作。

---

## 5. 安装脚本评估

### 5.1 当前分发形态

| 平台 | 当前分发方式 | 是否需要安装脚本 |
|---|---|---|
| Windows | GitHub Release 直下 NSIS setup.exe | **否**——NSIS installer 已是安装体验 |
| macOS | GitHub Release 直下 DMG（拖入 Applications） | 短 install.sh 可缩短首装路径（`curl \| bash` vs 浏览器下载→打开 DMG→拖动） |
| Linux | 无构建产物 | N/A（未来 deb/rpm 或 AppImage 时再评估） |
| Go server | GitHub Release 直下 .exe | 若有用户自部署 Hub/Edge 需求，install.sh/ps1 有用 |

### 5.2 若做 install.sh/ps1，Codeg 的抄点与补课

**必抄**（Codeg install.sh 的精华）：

1. **平台检测 + 工件选择**：uname OS/ARCH → 对应下载 URL
2. **写前完整性检查**：解包前确认所有必要文件在归档内（fail fast）
3. **幂等短路 + 自愈**：已是目标版本 + 文件完整 + 无 PATH shadow → exit 0；半安装残局被修复而非永远 skip
4. **装后实解析验证**：`command -v` 解析路径必须等于新装路径，三种失败各给修复指引
5. **升级序**：先停旧进程再覆盖二进制（Unix cp 覆盖 / Windows exe 写锁）

**必须补课**（Codeg 的反面教材——安装脚本不验签）：

> Codeg 发布端产出 `.sig` 与 `.sha256`（release.yml:740-763），服务器自更新端验签（update/verify.rs），但首次 `curl | bash` / `irm | iex` 路径裸信 HTTPS。信任链最该闭合的首装环节反而是开的。

AgentHub 若做安装脚本，必须在脚本内置 **minisign 签名验证**（公钥硬编码在脚本中，与 `tauri.conf.json` 的 pubkey 同值）。实现短小（约 20 行）：下载 `.sig` → 验证 `.sig` 与下载的二进制 → 未通过即 `exit 1` 并打印修复指引。

### 5.3 优先级

安装脚本在 AgentHub 当下分发形态（NSIS installer + DMG）中不是 bottleneck——两平台已有标准安装体验。建议 **P3（Optional）**，且仅在以下条件满足后启动：
- 全平台 signing + updater 通道已上线
- 有证据显示用户因 "下载→安装" 路径摩擦而流失

---

## 6. 证据闭环

### 6.1 roadmap P1「Desktop packaged boundary」→ closed 路径

| 当前 | 缺什么 | 验收证据形态 | Phase |
|---|---|---|---|
| `real_tested=false`（dry gate） | real Tauri 构建产物已上传到 release，但签名/更新元数据缺失 | `latest.json` + `.sig` 文件存在于 release assets + updater endpoint 返回 200 | Phase 1 |
| 仅 Windows NSIS | macOS signed DMG + darwin updater 通道 | macOS DMG 含签名 + `codesign -dvvv AgentHub.app` 输出证书信息 + `spctl --assess -vvv AgentHub.app` 输出 "accepted" | Phase 2 |
| 仅 Windows NSIS | Windows updater 通道实际可工作 | 从 v0.5.0 到 v0.6.0 的自动更新流程真实通过一次（真机视频或截图，私存） | Phase 1 |

**闭环判定**：Phase 1 完成（最新 release 的 assets 包含 latest.json + .sig，且 `curl -I https://github.com/TokenDanceLab/AgentHub/releases/latest/download/latest.json` 返回 200）+ 一次成功的 updater 证明 → roadmap P1 「Desktop packaged boundary」从 open 转 closed。

### 6.2 AH-SR-035 → closed 路径

| AH-SR-035 | Hub OIDC 登录缺少浏览器完整授权码流证据 |
|---|---|
| 当前状态 | High, Mitigated in repo; deploy verification required |
| 与本次关联 | 无直接关联——AH-SR-035 是 Hub 端部署证据，不是 desktop packaging 证据 |
| 闭环路径 | staging/production 上完成一次完整 OIDC browser login → 私存无密证据 → 更新 register 状态为 closed |

**AH-SR-035 不被本提案覆盖。** 它的闭环是单独部署任务。

### 6.3 AH-SR-036 → closed 路径

| AH-SR-036 | Desktop 真实登录闭环缺少证据 |
|---|---|
| 当前状态 | High, Mitigated in repo; deploy/client verification required |
| 与本次关联 | Desktop 对 live Hub 完成 login/logout/reconnect 是 packaged Desktop 的功能正确性验证 |
| 闭环路径（两步） | **Step 1**（需 packaged Desktop）：用 packaged/signed/intact-updater 的 Desktop build 对 live Hub 完成一次完整 login→logout→reconnect → 私存无密证据。**Step 2**：更新 risk register 状态为 closed |

**本提案覆盖 AH-SR-036 的 precondition**（使 packaged Desktop 可用），不覆盖 AH-SR-036 的 closing 本身（那是 live login E2E 任务）。做完 Phase 1-2 后，AH-SR-036 的 precondition 满足，可另开任务做 login 闭环。

### 6.4 验收证据形态一览

| 验收项 | 证据形式 | 公开/私存 |
|---|---|---|
| tag 守卫 CI 通过 | workflow run log | 公开（CI log） |
| draft-flip 原子发布成功 | release 页面：draft → published 时间线 + 全平台 assets 齐全 | 公开 |
| latest.json 200 | `curl -I <endpoint>` 输出 | 公开 |
| .sig 文件存在 | release assets 列表 | 公开 |
| Tauri updater 通道端到端 | 真机桌面从旧版 → 新版自动更新录屏 + 更新后 `codesign/Get-AuthenticodeSignature` 验证 | 私存 |
| macOS 签名验证 | `codesign -dvvv AgentHub.app` + `spctl --assess -vvv` 输出 | 公开（CI log） |
| 安装脚本签名验证 | 脚本内 minisign verify 步骤的终端输出 | 公开 |

---

## 7. 分阶段清单

### Phase 1: 无 secrets 可立即执行（预计 S-M，2-4 天开发）

**目标**：版本单源 + tag 双守卫 + draft-flip 原子发布 + updater 通道真通

| # | 任务 | Effort | 前置 | 具体变更 |
|---|---|---|---|---|
| 1.1 | **版本源收敛**：tauri.conf.json 为 SSOT，CI 强校验所有源一致 | S | 无 | 新增 `scripts/release/verify-version-consistency.ps1`（读全部 7 个源，断言全部等于 tauri.conf.json version）；release.yml create-draft 步骤前调用 |
| 1.2 | **tag 双守卫** | S | 1.1 | release.yml 新增 `create-draft` job（独立 runs-on ubuntu-latest）：merge-base --is-ancestor 检查 + 版本一致性调用 1.1 脚本 |
| 1.3 | **draft-flip 原子发布** | M | 1.2 | 重构 release.yml：(a) create-draft job 出 draft release；(b) 各 platform 构建上传到 draft；(c) 新增 `publish-release` job，`needs` 全部 platform，仅当全部 success 调 `gh release edit --draft=false`；(d) 新增 `upload-updater-metadata` job 上传 latest.json+.sig 到 release assets |
| 1.4 | **latest.json 产出强制化** | S | 1.3 | 把现有 if-present 收集改为 fail-if-missing；所有 platform job 产出 latest.json → publish 阶段聚合为多平台 latest.json（含 windows-x86_64 + darwin-aarch64 platform 签名） |
| 1.5 | **验证 updater endpoint 200** | S | 1.4 | publish-release 完成后 `curl -I <updater_endpoint>` 断言 200，非 200 回退 draft（保留不发布） |
| 1.6 | **NSIS installerHooks sidecar 清理** | S | 1.3 | 新增 `app/desktop/src-tauri/windows/installer-hooks.nsh`：升级前 `taskkill /F /T /IM agenthub-edge.exe`；`tauri.conf.json` 的 `windows.nsis.installerHooks` 指向该文件 |
| 1.7 | **废弃 cd-desktop.yml 和 scripts/release/release.ps1** | S | 1.3 | cd-desktop.yml 添加注释 "DEPRECATED — use release.yml tag push instead"；release.ps1 不再维护（或简化为一键部署工具）；更新 AGENTS.md 和 .agents/skills/real-e2e-acceptance/SKILL.md 中的发布入口引用 |

**管理员物料**：无（全部用已有 secrets：`TAURI_SIGNING_PRIVATE_KEY`、`EXPO_TOKEN`）。

**Phase 1 完成后验收**：
- 推 tag v0.6.0-rc.1 → workflow 全绿 → GitHub 出现跨平台 full draft → 自动翻正式 → latest.json 200
- Desktop 从 v0.5.0 自动更新到 v0.6.0-rc.1（真机验证，私存证据）
- 安全风险 register AH-SR-036 添加 note："precondition met — packaged Tauri with working updater channel; live login E2E pending"

---

### Phase 2: 需 secrets（macOS 签名+公证，预计 M，1-2 周开发）

**目标**：macOS DMG 含 Developer ID 签名 + notarytool 公证 + darwin updater 通道

| # | 任务 | Effort | 前置 | 具体变更 |
|---|---|---|---|---|
| 2.1 | **管理员采购并配置 macOS 签名 secrets** | 人工 | 管理员 | Apple Developer Program $99/年 → 创建 Developer ID Application 证书 → 导出 .p12 → 生成 app-specific password → 设置 6 个 GitHub secrets（见 §3.2） |
| 2.2 | **macOS 签名 workflow** | M | 2.1 | 以 Codeg release.yml:330-566 为样板：(a) build-desktop-macos job 新增 import-cert step（临时 keychain 导入 p12）；(b) tauri-action 新增 `APPLE_ID/PASSWORD/TEAM_ID` env 自动公证；(c) always() 清理段恢复 keychain |
| 2.3 | **darwin updater 通道** | S | 2.2 | latest.json 聚合阶段补充 darwin-aarch64 平台入口；评估是否需 DMG→.app.tar.gz 格式切换 |
| 2.4 | **macOS 签名 verification step** | S | 2.2 | publish 前 `codesign -dvvv AgentHub.app` + `spctl --assess -vvv AgentHub.app` 断言输出含 "accepted" |
| 2.5 | **更新 release-readiness 治理面** | S | 2.2 | 移除 macOS 签名/公证的 "later approval slice" 标记；更新 governance-execution.md D2b 章节 |

**管理员采购清单**：

| 项 | 供应商 | 价格 | 获取方式 | 备注 |
|---|---|---|---|---|
| Apple Developer Program | Apple | **$99/年** | developer.apple.com → Enroll | 个人或组织账户均可；TokenDance 已有 Apple 账户可复用 |
| Developer ID Application 证书 | Apple（含在 Program 内） | $0 | developer.apple.com → Certificates → Developer ID Application | 需 macOS 本地 Keychain Access 生成 CSR → 上传 → 下载 → 导出为 .p12（设置密码） |
| App-Specific Password | Apple | $0 | appleid.apple.com → Sign in → App-Specific Passwords | **不是主密码**，专用于 notarytool |
| Team ID | Apple | $0 | developer.apple.com → Membership | 10 字符字母数字 |

**Phase 2 完成后验收**：
- macOS 端 `codesign -dvvv AgentHub.app` 显示 Developer ID 签名
- `spctl --assess -vvv AgentHub.app` 输出 "accepted"（Gatekeeper 通过）
- macOS 从旧版到新版 updater 端到端通过（真机验证）
- release-readiness.yml macOS unsigned dry policy 撤销（或保留为 history artifact）
- 安全风险 register 更新：packaged/signing macOS 项可标 closed

---

### Phase 3: 可选（Windows 签名 / 安装脚本 / Linux 桌面，P2-P3）

| # | 任务 | Effort | 前置 | 优先级 | 说明 |
|---|---|---|---|---|---|
| 3.1 | **Windows Authenticode 签名** | M | Phase 1 | P2（用户量 > 500 后） | EV 证书 $300-500/年 或 OV $120-200/年；`signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com ...` |
| 3.2 | **install.sh + install.ps1（带验签）** | M | Phase 1 | P3（用户流失数据支撑后） | Go server/CLI 安装脚本；必须含 minisign 验签（公钥硬编码），抄 Codeg 的写前完整性/幂等自愈/装后验证三件套 |
| 3.3 | **Linux 桌面构建** | L | Phase 1 | P3（Linux 桌面用户需求明确后） | deb/rpm/AppImage + tauri-updater Linux 通道 |
| 3.4 | **服务器自更新 + 回滚** | L | P3（Go server 有用户自部署需求后） | Codeg 的 .bak + exit 86 + 30s 试用窗口 + supervisor 重拉——完整参考设计 |
| 3.5 | **Docker 多架构发布** | M | Phase 1 | P2 | buildx linux/amd64+arm64 → ghcr.io + Docker Hub |

---

## 8. 非本次范围（显式 defer）

- **AH-SR-035 闭环**：这是独立的 Hub 部署任务，不在 desktop packaging 范围内
- **AH-SR-036 真实登录闭环**：precondition 由本提案满足（有 packaged/signed Desktop），closing 本身是独立 live E2E 任务
- **Go server 自更新**：Codeg 的完整参考设计已记录（devx.md §4.3），Phase 3.4 再评估
- **Mobile release 通道**：现有 `release.yml` 的 APK 构建保留不动，Expo EAS 通道独立于本文
- **Changelog 风格**：`generate_release_notes: true` 维持，不强制双语（可 Phase 1 后评估）

---

## 9. 实施纪律

1. **敏感信息红线**：本文档不含任何真实密钥、证书内容或私有 token。secrets 只写名字与获取方式。
2. **逐 Phase 批准**：每 Phase 开独立 issue + PR，获管理员批准后实施。本 PROPOSAL 批准后不代表可以直接动手改 workflow——它授权的是"这个方向可以推进"。
3. **Phase 1 PR 禁碰 macOS 签名**：保持 `release-readiness.yml` 的 macOS later approval slice 标记有效，直到 Phase 2 管理员配置 secrets 后再启用。
4. **回滚能力**：Phase 1 改造 release.yml 时保留旧 `release.yml` 的副本作为回退路径（命名 `release-legacy.yml` 或 git revert）。
5. **验证脚本不删**：现有的 `verify-tauri-package-readiness.py`、`verify-release-gate.py`、`release-readiness.yml` 三层治理面是 AgentHub 优于 Codeg 的工程资产，**不删不改**，在新 workflow 中作为前置 gate 调用。

---

## 10. 摘要

| 维度 | 当前 | Phase 1 后 | Phase 2 后 |
|---|---|---|---|
| 版本 SSOT | 7 源无校验 | CI 强校验所有源 = tauri.conf.json | 不变 |
| tag 守卫 | 无 | merge-base ancestry + 版本一致双断言 | 不变 |
| 原子发布 | draft=false 直出 | draft→全绿→flip 正式 | 不变 |
| updater 通道 | latest.json 404 | 200 + .sig + Windows NSIS 可更新 | + macOS DMG 可更新 |
| macOS 签名 | unsigned | unsigned（带明示） | Developer ID + notarytool |
| minisign 工件 | 已配置未产出 | 所有安装资产带 .sig | 不变 |
| 安装脚本 | 无 | 无（NSIS/DMG 为主分发） | 可选（带验签） |
| AH-SR-036 | deploy/client evidence defer | precondition satisfied | closed（live login E2E 完成后） |
| Roadmap P1 packaged boundary | open | closed（updater 通道真实可工作） | closed（+ macOS 签名证据） |
