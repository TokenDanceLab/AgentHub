# GOAL

**日期**: 2026-06-02 | **分支**: dev/delicious233 | **截止**: 2026-06-10

## 🟢 本轮完成 (Sprint 6)

| 功能 | 优先级 | 状态 |
|------|:--:|:--:|
| 多预设主题引擎 (6套×2变体) | P2 | ✅ |
| API 响应格式统一 (5处→Response包装) | P1 | ✅ |
| edge-real 集成测试修复 (37个 401→通过) | P1 | ✅ |
| CSS 硬编码颜色全量替换 (14+10=24处) | P1 | ✅ |
| Desktop en.json +260 keys 完整同步 | P0 | ✅ |
| Web PromptInput 硬编码中文→t() | P1 | ✅ |
| Desktop ChatView 虚拟化 (@tanstack/react-virtual) | P0 | ✅ |
| ErrorBoundary 升级 (chunk error+i18n+stack trace) | P0 | ✅ |
| WS 重连 UI 横幅 (脉冲动画+刷新+FadeOut) | P1 | ✅ |
| StatusHandler: boolean→TransportStatus 透传 | P0 | ✅ |
| noUncheckedIndexedAccess: true (14 TS errors fixed) | P0 | ✅ |
| Web ViewSlot+shell / ViewMode+team 类型修复 | P0 | ✅ |
| mobile 测试: 5文件25用例 (2→27通过) | P1 | ✅ |
| hub-server log(9)+metrics(7) 测试补全 | P1 | ✅ |
| Handler 错误码透传 (12处) | P1 | ✅ |
| Go 资源泄漏修复 (3处 defer Close) | P2 | ✅ |
| 硬编码生产URL移除 (mobile 3处+Rust 1处) | P1 | ✅ |
| web/desktop config: localhost fallback生产环境警告 | P2 | ✅ |
| vite config补齐 (envPrefix+safari15) | P1 | ✅ |
| 分支整理: trump-frontend+closeout+johnny-hub 已删除 | — | ✅ |

## 竞品差距完成进度
| 优先级 | 功能 | 
|:--:|------|
| P0 | Stable block keys + React.memo ✅ |
| P0 | ErrorBoundary chunk error自动恢复 ✅ |
| P0 | Desktop ChatView 虚拟化 ✅ |
| P0 | Web ViewSlot/ViewMode 类型修复 ✅ |
| P0 | noUncheckedIndexedAccess strict ✅ |
| P1 | Tool call auto-grouping ✅ |
| P1 | Orchestrator sub-agent streaming/result injection ✅ |
| P1 | WS 重连 UI 横幅 ✅ |
| P1 | API 响应格式统一 ✅ |
| P2 | Error classification + ErrorBlock UI ✅ |
| P2 | 多预设主题引擎 (6套) ✅ |

## 工程质量指标
| 指标 | 状态 |
|------|:--:|
| Desktop TS | 0 errors (含 strict) |
| Web TS | 0 errors |
| Mobile TS | 0 errors |
| Desktop 测试 | 108/109 通过 (1文件需Go服务器) |
| Mobile 测试 | 27/27 通过 |
| Go 后端 | 编译+vet 全部通过 |
| Go 测试 (`-short`) | hub 18/18包通过 (2包无测试) edge 16/16包通过 |
| Go 集成测试 | hub-server/tests 总包需PostgreSQL(用 `-short` 绕过) edge-server/adapters 总包需CLI二进制(用 `-short` 绕过) |
| CSS 硬编码颜色 | 0 残留 |
| 硬编码生产 URL | 0 残留 |
| i18n key 同步 | Desktop 1496/1496 Web 238/238 |
