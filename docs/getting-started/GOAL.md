# GOAL

**日期**: 2026-06-02 | **分支**: dev/delicious233 | **截止**: 2026-06-10 | **Total commits**: 21 (自2dc7ffc)

## 🏆 全部竞品差距关闭 (11/11 P0-P2)

| 优先级 | 功能 | 状态 |
|:--:|------|:--:|
| P0 | Stable block keys + React.memo | ✅ |
| P0 | ErrorBoundary chunk error自动恢复+i18n+stack trace | ✅ |
| P0 | Desktop ChatView 虚拟化 (@tanstack/react-virtual) | ✅ |
| P0 | Web ViewSlot/ViewMode 类型修复 | ✅ |
| P0 | noUncheckedIndexedAccess strict | ✅ |
| P1 | Tool call auto-grouping | ✅ |
| P1 | Orchestrator sub-agent streaming/result injection/progress | ✅ |
| P1 | WS 重连 UI 横幅 (脉冲+刷新+FadeOut) | ✅ |
| P1 | API 响应格式统一 (5处→Response) | ✅ |
| P2 | Error classification (8 categories) + ErrorBlock UI | ✅ |
| P2 | 多预设主题引擎 (6套×2变体: Classic Blue/Claude Warm/ChatGPT/DeepSeek/One Dark/Dracula) | ✅ |

## 工程质量修复 (30+项 P0-P3)

### 后端 Go
| 修复项 | 优先级 |
|--------|:--:|
| Handler 错误码透传 (12处 relay/session/notification/contact/custom_agent/execution_target/market/mcp_server/audit) | P1 |
| Go 资源泄漏修复 (3处 defer Close: file_store/attachment/run_output) | P2 |
| Windows文件锁修复 (Rename前显式Close) | P1 |
| API 响应格式统一 (health/public/router 5处) | P1 |
| hub-server 测试覆盖率 50.3→51.2% (middleware+9.8%) | P1 |
| hub-server log(9用例)+metrics(7用例) 测试补全 | P1 |
| edge-store Windows兼容 (TestFileStoreLastPersist 连续3x通过) | P1 |
| CSP端口 3210→*通配符 | P1 |
| edge_health.rs 重复emit移除 | P2 |

### 前端架构
| 修复项 | 优先级 |
|--------|:--:|
| Desktop ChatView 虚拟化移植 (Web→Desktop, estimateSize差异化, useAutoScroll RAF) | P0 |
| ErrorBoundary chunk error自动恢复+i18n+可折叠stack trace | P0 |
| noUncheckedIndexedAccess:true (14 TS errors修) | P0 |
| Web ViewSlot+shell / ViewMode+team 类型修复 | P0 |
| WS 重连 UI 横幅 (连接丢失/重连中/失败三态) | P1 |
| StatusHandler: boolean→TransportStatus 全栈透传 | P0 |
| WebLayout 1117→970行 (useWebAuth+useStreamRecovery 拆分) | P2 |
| Desktop 3组件→@shared/ui (EmptyState/ToolTimeline/PermissionModePicker) | P0 |
| shared/ui barrel: 13未用组件移除导出 | P2 |
| react-router-dom 死代码移除 | P2 |
| Mobile组件测试 2→27用例 (5新文件) | P1 |

### 前端样式/配置
| 修复项 | 优先级 |
|--------|:--:|
| CSS 硬编码颜色 150+处→CSS变量 (33个文件) | P1 |
| PWA补齐 (Mobile图标+Web manifest+favicon+theme-color) | P0 |
| Tauri配置 (Desktop minSize+updater, Mobile bundle) | P0-P1 |
| 多预设主题引擎 (6套×2变体) | P2 |
| vite配置补齐 (envPrefix+safari15) | P1 |
| Tray托盘 i18n动态化 (Rust set_tray_labels+前端TrayLabelSyncer) | P2 |

### i18n / 安全
| 修复项 | 优先级 |
|--------|:--:|
| Desktop en.json +260 keys (1496/1496 完全同步) | P0 |
| Web PromptInput 硬编码中文→t() | P1 |
| Web +80 i18n翻译key (code/prompt/notification/time/chat/welcome/im全模块) | P1 |
| 硬编码生产URL移除 (mobile 3处+Rust 1处) | P1 |
| web/desktop localhost fallback 生产环境警告 | P2 |

### 文档/治理
| 修复项 | 优先级 |
|--------|:--:|
| STATE.md 近三轮Sprint汇总+工程指标表 | P1 |
| roadmap.md 日期+竞品对标标记 | P1 |
| AGENTS.md 日期+死链接修复 | P1 |
| README badge P0-P1→v0.1.0-活跃开发 | P0 |
| .gitignore 输出目录+构建产物补全 | P2 |
| 分支整理: trump-frontend-closeout+johnny-hub-fixes+trump-desktop-smoke 已删除 | — |
| 比赛材料清查 (0残留) | P0 |

## 🎯 工程质量仪表盘 (最终)

| 指标 | 状态 |
|------|:--:| 
| Desktop TS | **0 errors** (含 noUncheckedIndexedAccess strict) | 
| Web TS | **0 errors** |
| Mobile TS | **0 errors** |
| Desktop 测试 | **1165/1165 全通** (109文件) |
| Mobile 测试 | **27/27 全通** (6文件) |
| Go 编译+vet | **Edge ✓ Hub ✓** |
| Go 测试 (`-short`) | **hub 19/19包 edge 17/17包** |
| 8 执行场景 | **32/32** (local_edge/remote_ssh/hub_relay/tailscale/cloud_edge) |
| CSS 硬编码颜色 | **0残留** (150+处→变量 33文件) |
| 硬编码生产URL | **0残留** |
| i18n key同步 | **Desktop 1496/1496 Web 238/238** |
| PWA | Mobile+Web 均已配置 manifest+icons |
| 仓库结构 | 1本地分支 320 TSX + 265 TS + 290 Go + 222 CSS |
| 测试文件 | 126 Go测试 + 109 Desktop测试 |
