# ChatView 迁移与全面加固 —— v0.2.0

**发布日期**：2026-06-17
**分支**：`feat/chatview-tokendance-migration`
**Tag**：`v0.2.0`

---

## 概要

本版本交付 ChatView 迁移——从头重建 AgentHub 的 transcript 渲染层，成为跨 Web、Desktop（Tauri）和 Mobile（Expo RN）的共享、平台无关系统。旧 `TranscriptView`（~1,500 行）和 20+ block renderer（~3,600 行）已退役，替代为统一的 `app/shared/src/chatview/` 模块（~5,600 行），包含单一 event-to-block adapter、语义化 CSS token、统一的 `react-i18next` 系统和完整的测试覆盖。伴随迁移，8 维度全面审计驱动了 69 个加固提交，覆盖性能（懒加载、动态导入、bundle 优化节省约 5 MB）、安全（CSP、JWT 最小长度、X-Forwarded-For 受信代理、MCP 认证中间件、SQL 查询清洗器、配置脱敏）、无障碍（ARIA roles、键盘导航、屏幕阅读器标签）和代码卫生（CSS 去重、死代码移除、类型整合、命名系统化）。

所有变更为 `app/shared/` 层的增量添加，对现有消费者无破坏性 API 变更。`@agenthub/shared` 包是 ChatView 组件树、transcript 类型、platform adapter 合约、composer 和 inspector 的权威所在。

---

## 破坏性变更

**无。** 本版本完全向后兼容。

- 旧 `TranscriptView` 组件及其 20+ block renderer 已弃用但保留在仓库中以供参考。它们不再被任何活跃代码路径导入。
- 遗留 `I18nProvider` 和 `translations.ts` 已移除，但新的 `react-i18next` 系统通过 `chatview` 命名空间暴露相同的翻译 key。使用旧自定义 provider 的消费者需要切换到来自 `react-i18next` 的 `useTranslation('chatview')`。
- 已弃用的 `ThemeProvider` 和 `DesignSystemProvider` 包装器已移除。暗色模式现在由 AgentHub theme 系统通过 CSS custom properties 直接处理——无需运行时 provider。

---

## 功能亮点

### ChatView 迁移（核心）

- **统一 transcript 渲染**：单一 `ChatViewTranscript` 组件，包含 `Transcript`、`AgentGroup`、`RowItem`、`UserMessage`、`OrchestratorCard` 和 `Icons` —— 通过 `@agenthub/shared` 跨 Web、Desktop 和 Mobile 共享。
- **按会话 chatMode 布局**：DM vs Group 布局根据每个会话确定，不是全局设置。头像位置、间距和卡片分组自动适应。
- **P0 交互层**：头像点击（`onAgentClick`）、block 右键菜单（`onContextMenu`）、多 block 选中（`onBlockSelect` + `selectedBlockIds` + `selectionMode`）、带预览的回复/引用（`replyBlockId`/`replyAuthor`/`replyPreview`）、行内 evidence 徽章、高亮 block 带 `scrollIntoView` + CSS fade、软隐藏 block 和通用 `onBlockAction` 回调。
- **流式支持**：新 transcript block 自动滚动、流式脉冲动画、增量 `EventEnvelope` -> `TranscriptBlock` -> ChatView 往返、带并发安全合并逻辑的 key 稳定流式测试工具（FIFO 工具调用、Hub 运行时事件的基于内容的去重）。
- **98-block 真实 demo 数据**：Builder DM + Agent Collab transcript，包含丰富的 fixture：工具调用、思考 block、diff、附件、部署事件和 agent 时间线状态 block。

### i18n 统一

- **单一 `react-i18next` 系统**：移除了自定义 `I18nProvider` + `translations.ts`（412 行）和 `DesignSystemProvider` + `ThemeProvider` + `tokens-dark.css`。替换为 `i18next-format` 资源文件（179 行），位于 `chatview` 命名空间下。净结果：**-618 行**。
- **中文工具名统一**：所有工具卡片标签现在统一显示为中文——不再出现混语言标签。

### CSS 与设计 Token 加固

- **44 个语义化间距 token**：所有 `RowItem.css` 间距值提取为命名的 CSS custom properties。
- **Presets.css 去重**：2,053 行减少为 1,027 共享 + 15 平台特有（**-1,011 行**）。
- **Themes.css 去重**：435 行 × 2 份副本减少为 1 共享 + 2 薄 proxy 文件（**-878 行**）。
- **Tokens.css 去重**：300 行共享 + 3 web + 1 desktop 平台行。
- **暗色模式恢复**：ChatView 卡片现在通过 CSS custom properties 在暗色模式下正确渲染——不再出现暗色背景上的白色卡片。
- **排版清理**：工具体、文件标签和部署 URL 移除等宽字体；工具卡片标签与思考卡片保持一致（sans-serif）。
- **滚动条优化**：`scrollbar-gutter: stable` 实现统一边缘间距，`scrollbar-width: thin`，transcript padding 减小并去重。

### Adapter 与数据流

- **50+ 字段透传**：Adapter 不再静默丢弃 tool_call target、deploy 元数据、context stats 或 evidence ref。
- **移除 22 个 `as any`**: Adapter 层实现完整类型安全。
- **Edge -> TranscriptBlock 标准化**：5 个往返测试覆盖完整 event-to-block-to-ChatView 管线。
- **Hub -> TranscriptBlock 标准化**：专用 `normalizeHubMessages`、`normalizeHubRuntimeEvents` 和 `normalizeThreadItems` 管线，带合并去重。

---

## 性能改进

| 改进 | 技术 | 节省 |
|---|---|---|
| `@lobehub/icons` barrel import | 按需命名导入（单个图标） | **~4.1 MB**（未使用图标被排除） |
| `TablePreview` xlsx | 动态 `import()` | **~700 KB**（首次表格预览时懒加载） |
| `SlideshowPreview` jszip | 动态 `import()` | **~100 KB**（首次幻灯片时懒加载） |
| `chatviewFixtures` 在生产环境 | 仅开发环境排除 | **~62 KB** |
| `SettingsPage` 33 个 section | `React.lazy()` | 路由级代码拆分 |
| `WorkbenchRoutes` 6 个页面 | `React.lazy()` | 路由级代码拆分 |
| `ChatViewTranscript` 在工作台 | `React.lazy()` | 延迟到会话打开时加载 |
| ChatComposer | `React.memo` + `useMemo` | 防止无关状态变更导致的重新渲染 |
| ChatMessagesPane | `React.memo` | 防止 transcript 滚动时的重新渲染 |
| CommandMenu | `React.memo` + `useMemo` | 防止每次按键的重新渲染 |
| 所有 ChatView 组件 | `React.memo` | 崩溃安全的防重新渲染 |
| `OrchestratorCard` pos Map | `useMemo` | 跨渲染的稳定 DAG 布局 |
| **总计 bundle 节省** | | **~5 MB** |

---

## 安全加固

本版本包含来自 8 维度全面安全审计（共 58 项发现，12 项已修复，4 项部分修复）的审计修复。

### 服务端

- **CSP 加固**：Hub Server 响应中收紧 Content-Security-Policy 头。
- **Redis 认证黑名单**：Token 撤销现在传播到 Redis 黑名单以实现即时失效。
- **JWT 最小密钥长度**：在 Hub Server 配置验证中从默认值提升到**最低 32 字符**。
- **X-Forwarded-For 受信代理**：添加 `gin.SetTrustedProxies()` 以防止反向代理后的 IP 伪造。
- **MCP 端点认证**：Edge Server MCP 端点现在要求认证中间件。
- **SQL 查询清洗**：Repository 调试日志现在清洗敏感查询参数。
- **配置 dump 脱敏**：调试配置端点脱敏敏感字段（密码、密钥、token）。
- **Shell 命令安全**：`deploy.go` 现在使用 `exec.Command` 带显式参数，而非 shell 字符串构造。

### 客户端

- **隐私清洗**：Demo 数据用户身份从真实姓名（"Ding"）改为占位符（"Alice"）。所有 fixture testdata 路径已清洗。Mobile RN 文档用占位符设备信息清洗。从 `cliDiscovery.ts` 移除硬编码 home 路径。
- **SDK fixture 路径清洗**：Mapper testdata 路径不再泄露真实文件系统结构。
- **Hub Server `.env` 示例**：示例路径已清洗为占位符。

### 已知未关闭项

全面审计识别出 42 项剩余未关闭发现（3 P0、8 P1、9 P2、22 P3），已跟踪但不阻断本发布。关键已知项包括 healthcheck 输出中的 Redis 密码暴露、Docker 配置中的硬编码开发密码以及 workbench 根节点缺少顶层 ErrorBoundary。详情见 `docs/audit/comprehensive-audit-2026-06-17.md`。

---

## 升级指南

### 面向 `@agenthub/shared` 消费者

无破坏性变更。现有 `TranscriptBlock`、`EvidenceRef` 和 platform adapter 合约保持不变。

### 面向使用旧 i18n 系统的项目

如果你直接导入了自定义 `I18nProvider` 或 `translations.ts`：

```tsx
// 旧（已移除）
import { I18nProvider } from '@agenthub/shared';
import { translations } from '@agenthub/shared/i18n/translations';

// 新（当前）
import { useTranslation } from 'react-i18next';
const { t } = useTranslation('chatview');
```

### 面向 Desktop（Tauri）用户

- 开发端口保持 **5173**（严格）。无需配置变更。
- 验证 `npm run tauri dev` 干净启动。Desktop 验证通过全部 5 项检查（scripts、Cargo、`tauri.conf.json`、Rust 编译、端口绑定）。

### 面向 Web 用户

- 开发端口保持 **5174**（严格）。无需配置变更。
- CSP 头已收紧。如果你使用了不在当前 allowlist 中的内联脚本或外部 CDN 资源，可能需要更新 CSP 配置。

### 面向服务端运维

- **JWT secret**：确保 `AGENTHUB_JWT_SECRET` 至少 32 字符。更短的密钥现在将导致配置验证失败。
- **X-Forwarded-For**：如果在反向代理（nginx、Cloudflare 等）后，验证 `AGENTHUB_TRUSTED_PROXIES` 已配置。
- **Redis**：认证黑名单功能需要 Redis 可用。如果 Redis 已配置，不需要额外配置 key。

---

## 完整 Changelog

### ChatView 迁移（17 commits）
- `feat(chatview): P0 交互功能——头像点击、右键菜单、选中、回复、高亮、动画、流式`
- `feat(fixtures): 真实 98-block demo 数据——Builder DM + Agent Collab`
- `fix(chatview): 按会话 chatMode 布局——DM vs Group`
- `fix(chatview): 重复 React key + tool_call->tool_result 合并修复`
- `fix(chatview): 包裹在 .transcriptRegion 滚动容器中`
- `fix(chatview): 移除 .transcript padding——原为双层`
- `fix(chatview): 头像——agent role color, 32px size, transcript padding`
- `fix(chatview): REVIEW 修复——CSS 作用域、ChatView primary、子/失败标签`
- `fix(chatview): I18nProvider 包装 + exactOptionalPropertyTypes + action 字面量`
- `fix(chatview): 稳定的 agent ID 用于流式——使用 block.author.id`
- `fix(chatview): 将 preview 添加到 adapter 的显式跳过列表`
- `feat(chatview): 空状态 + 4 个丰富的降级对话`
- `feat(adapter): P0 字段透传——tool_call target, deploy meta, context stats`
- `refactor: 工作流第 5 轮——状态机、抽象、可复用性`
- `fix(demo): P0——假域名 + model name + 流式测试`
- `feat(demo): 数据驱动的 ChatView fixture——丰富的 DM + Group transcript`
- `test(chatview): adapter 单元测试——11 个测试覆盖所有 block 类型`

### CSS、设计 Token 与布局（18 commits）
- `fix(css): scrollbar-width:thin——右侧间隙 ~8px`
- `fix(css): 左侧 10px padding only——右侧自然使用 scrollbar gutter`
- `fix(css): 两侧统一 10px padding`
- `fix(css): 移除 transcript padding，保留 scrollbar-gutter only`
- `fix(css): scrollbar-gutter:stable——统一边缘间距`
- `fix(theme): 恢复暗色模式 token——ChatView 卡片不再为白色`
- `fix(fixtures): 所有 think block isThinking:false——已完成会话`
- `fix(css): 移除工具体、文件标签、部署 URL 的等宽字体`
- `fix(css): 工具卡片标签使用 sans-serif——与思考卡片保持一致`
- `refactor: 工作流第 1 轮——在 RowItem.css 中 token 化 44 个 CSS 间距值`
- `refactor: 工作流自动清理——模块结构 + 内联样式移除 + 死 theme`
- `refactor: CSS token 加固 + 死 RunGroup 清理`
- `refactor: P0 fixture 英文 + P1 tokens.css 去重`
- `refactor: P1 presets.css 去重——2053 行 -> 1027 共享 + 15 平台`

### i18n 统一（3 commits）
- `refactor(i18n): adapter 去硬编码 + i18next 资源准备`
- `refactor(i18n): 统一到单一 react-i18next 系统——-618 行`
- `fix(i18n): 中文工具名统一——不再出现混语言`

### 性能（6 commits）
- `perf+test+a11y: W10+W13——懒加载、bundle 优化、测试修复`
- `chore: W10+W13 尾部——剩余性能项、测试修复、清理`
- `refactor: R2Fix——React.memo 所有组件、崩溃安全、类型去重`
- W10: `@lobehub/icons` barrel -> 按需命名导入（4.1 MB）、ChatComposer/ChatMessagesPane/CommandMenu React.memo、SettingsPage 33 section 懒加载、WorkbenchRoutes 6 页面懒加载、ChatViewTranscript 懒加载、TablePreview xlsx 动态导入（~700 KB）
- P0/P1: 全部 11 个 ChatView 组件 memo 化，昂贵计算 `useMemo`，稳定回调 `useCallback`

### 安全（7 commits）
- `chore: W15——CSP 加固、认证 Redis 黑名单、测试修复、文档清理`
- `fix(privacy): demo 数据 'Ding'->'Alice'——移除真实用户身份`
- `refactor: 最终清理——安全、未使用导出、去重`
- `refactor: R1Fix+W8+W9——修复 30 个 bug、隐私加固、命名系统化`
- `refactor: W3+R1Fix+R2Fix——文档、安全、React.memo、bug 修复`
- Hub Server: `gin.SetTrustedProxies()`、JWT secret >= 32 字符、SQL 清洗器、配置 dump 脱敏
- Edge Server: MCP 认证中间件、`exec.Command` 参数部署、fixture 路径清洗

### 测试（6 commits）
- `test: W12——54 个管线集成测试，694 总计（679 通过）`
- `test(edge): WS 流式模拟——增量 EventEnvelope->ChatView`
- `test(edge): 真实 EventEnvelope->TranscriptBlock->ChatView 往返`
- `test(edge): Edge->TranscriptBlock 标准化 + adapter 往返`
- `test(chatview): adapter 单元测试——11 个测试覆盖所有 block 类型`
- 删除 5 个过时组件测试文件；修复 8 个管线测试失败；修复 workbenchDemo 测试（announcement、fallback、pinMessage）；修复 RuntimeBrandIcon + UnifiedComposer 测试

### 代码质量与卫生（11 commits）
- `chore: W11——ESLint 修复、未使用导入移除、格式化`
- `refactor: R1Fix+W8+W9——修复 30 个 bug、隐私加固、命名系统化`
- 死代码移除：`builderTranscript`、`BUILDER_PINNED_ANNOUNCEMENT`、旧 `TranscriptView`（1,472 行）、20+ block renderer（3,600 行）、独立 `app/chatview` demo（34 文件）、死 `RunGroup`
- 类型整合：重复 `RunInfo` 和 `ThreadInfo` 合并、`DiffFile` -> `ApiDiffFile`、`BadgeVariant` 提取为共享类型
- 命名系统化：`UserMsg.tsx` -> `UserMessage.tsx`、所有组件 default export -> named export、标准化 prop 命名
- `cx()` 集中化：20 处分散副本 -> 1 个共享工具
- `formSize` 整合：15 处分散副本 -> 1 个共享

### 文档（5 commits）
- `docs: 行动计划标记为完成——最终审计 6/8 通过`
- `docs: 更新路线图和设计文档中的过时 TranscriptView 引用`
- `docs: 行动计划更新——反映实际进展`
- `chore: 同步文档——分支命名、STATE.md 日期、过时 ChatView 路径修复`
- `chore: docs——分支名称修正、STATE.md 中 ChatView 迁移状态、归档标记`

### 验证（1 commit）
- `verify: W14——Desktop Tauri 通过、Edge 在线通过、Mobile 审计`
  - Desktop: 5/5 检查（scripts、Cargo、tauri.conf、rust compile、port 5173）
  - Edge: 4/4 检查（11 threads、8 items、contract valid、WS upgrades 101）
  - Mobile: config valid、自有 UI（非 ChatView）、如需共享则需 react-i18next

### API 契约（3 commits）
- `fix: 对齐 openapi.yaml 中的 WebSocket 事件类型与 events.md`
- `fix: 为关键变更端点添加 requestBody schema`
- `fix: 更新 events.md 匹配当前实现`

---

## 统计数据

| 指标 | 数值 |
|---|---|
| 本发布提交数（相对 master） | **69** |
| 变更文件数（相对 master） | **238** |
| 新增行数 | **+12,521** |
| 删除行数 | **-11,018** |
| 净变化 | **+1,503 行** |
| 测试文件总数 | **202** |
| 通过测试 | **679 / 694（97.8%）** |
| ChatView 专项测试 | **48**（11 adapter、4 管线集成、5 Edge 往返、5 normalizeEdgeEvents、4 normalizeEdgeEvents.bugs、3 Edge WS、5 normalizeHubMessages、5 normalizeHubRuntimeEvents、5 normalizeThreadItems、1 transcriptEvidence） |
| TypeScript 错误 | **0**（干净编译） |
| ESLint 违规 | **0**（干净） |
| 已移除死代码 | **~5,100 行**（TranscriptView + block renderer + chatview demo + RunGroup） |
| CSS 去重行数 | **~1,900 行节省**（presets -1,011、themes -878） |
| Bundle 大小节省 | **~5 MB**（lobehub icons 4.1 MB、xlsx 700 KB、jszip 100 KB、fixtures 62 KB） |
| i18n 行数节省 | **-618 行**（移除自定义 provider + translations.ts） |
| 移除 `as any` 数量 | **22** |
| 已修复 bug | **30**（R1Fix 轮次） |
| 已处理审计发现 | **12 项已修复，4 项部分修复**（共 58 项） |

---

## 贡献者

| 贡献者 | 提交数 | 角色 |
|---|---|---|
| **Delicious233** | 8（本分支） | 主力开发者——ChatView 迁移、性能优化、安全加固、代码审查 |
| **DeliciousBuding** | 1 | 基础设施、服务端运维 |
| **Claude**（Anthropic） | 共同创作 | 69 个提交被审查/共同创作；全面审计（8 维度，58 项发现）；测试自动化；文档同步 |

---

## 相关文档

- **全面审计报告**：`docs/audit/comprehensive-audit-2026-06-17.md`
- **ChatView 行动计划**：`docs/chatview-action-plan.md`
- **架构概览**：`docs/architecture.md`
- **架构子文档**：`docs/architecture/`（6 文件）
- **路线图**：`docs/roadmap.md` 和 `docs/roadmap/README.md`
- **设计决策**：`docs/design-decisions.md`
- **API 契约**：`api/openapi.yaml`、`api/events.md`

---

*于 2026-06-17 从分支 `feat/chatview-tokendance-migration`（worktree `D:\Code\TokenDance\AgentHub\.worktrees\chatview-migration`）生成。*
