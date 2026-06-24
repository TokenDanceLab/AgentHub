# ChatView 迁移 — 综合行动计划

> 2026-06-17 | **状态：活跃** — "完成"后 20 个 commit (d7f2bff0)，净增 ~6.4K 行 (+6.4K / -9.1K)，6 轮工作流，48 个 ChatView 测试，18 个 TS 错误（web app 中 exactOptionalPropertyTypes）。
> 剩余：9 项（3 P2、3 P3、3 Edge 集成）—— 均不阻塞 ChatView 迁移核心。

## Phase 1：审计 ✅
- [x] Workflow `audit-demo-data-and-components` — 3 个 agent 审计 demo 模式、数据合约、组件复用
- [x] 综合 agent 产出优先级行动清单
- [x] Review — 10/10 通过（架构、死代码、TS、CSS、i18n、adapter、集成、文档、git、server）
- [x] Demo 审计 — 10 项发现（3 个丰富对话、5 个问题）

## Phase 2：修复 P0 阻塞项 ✅
- [x] Attachment block：`String(a.attachmentRef)` → 提取 `.name` + `.size`
- [x] Adapter adapter.test.ts — 11 个测试覆盖所有 block 类型
- [x] 验证 fixture 中所有 TranscriptBlock 必填字段（deploy runId 已补）

## Phase 3：修复 P1 高优先级 ✅
- [x] ChatViewTranscript 空状态（'暂无消息'）
- [x] 7/10 会话现为丰富 fixture（原为 3/10）
- [x] CSS 去重：themes.css 435×2 → 1 共享 + 2 proxy（-878 行）
- [x] 死代码：builderTranscript + BUILDER_PINNED_ANNOUNCEMENT 已识别
- [x] tokens.css + presets.css 去重 — presets 1027 共享 + 15 平台，tokens 300 共享 + 3 web + 1 desktop
- [x] i18n key 去重 — 统一到单一 react-i18next 系统，-618 行（旧自定义 provider + translations.ts 已移除）

## Phase 4：修复 P2 中优先级
- [x] Adapter 字段透传 — 50+ 字段不再静默丢弃
- [x] 流式模拟工具（simulateStreaming + key 稳定性测试）
- [x] Edge→TranscriptBlock 标准化 + adapter 往返测试（5 个测试）
- [ ] Adapter 独立测试 fixture
- [ ] group mock 中缺失的卡片类型覆盖
- [ ] Desktop Tauri ChatView 验证

## Phase 5：修复 P3 低优先级
- [ ] 过时文档清理
- [ ] 命名一致性整理
- [ ] Desktop 验证（Tauri 中 ChatView）

## Phase 6：第 6 轮修复（"完成"后发现） ✅

d7f2bff0 "plan marked complete" 之后 20 个额外 commit — CSS 打磨、i18n 统一、布局 bug、暗色模式恢复。

- [x] **暗色模式 token 恢复** — ChatView 卡片在暗色模式下不再渲染为白色（ThemeProvider 已移除，AgentHub theme 直接处理暗色模式）
- [x] **i18n 统一到单一 react-i18next 系统** — -618 行：移除了自定义 I18nProvider、translations.ts（412 行）、DesignSystemProvider、ThemeProvider、tokens-dark.css；新增 i18next-format resources.ts（179 行）带 `chatview` 命名空间；通过 `useTranslation('chatview')` 接入 RowItem、UserMsg、ChatViewTranscript
- [x] **i18n：中文工具名统一** — 工具卡片中不再出现中英文混标签
- [x] **CSS：工具卡片标签使用 sans-serif** — 与思考卡片标签保持一致
- [x] **CSS：工具体、文件标签、部署 URL 移除等宽字体** — 改善可读性
- [x] **Fixture：所有 think block `isThinking: false`** — 已完成会话状态，无残留加载动画
- [x] **布局：ChatView 包裹在 `.transcriptRegion` 滚动容器中** — transcript 现可独立滚动
- [x] **布局：transcript padding 减小** — 头像更靠近边缘，移除双层 `.transcript` padding
- [x] **ChatView：重复 React key 已修复** — tool_call/tool_result 合并逻辑已修正
- [x] **ChatView：按会话 chatMode 布局** — DM vs Group 布局按会话确定，非全局
- [x] **Adapter：移除 22 个 `as any`** — 完全类型安全（在早期 commit 7553cfaa..1f066a57 中完成）
- [x] **CSS token 加固** — RowItem.css 中 44 个语义化间距 token，移除死代码 RunGroup + 内联样式
- [x] **P0 交互功能** — 头像点击、右键菜单、选中、回复、高亮、动画、流式 (ceed90a8)
- [x] **CSS 滚动条修复** — scrollbar-width:thin、scrollbar-gutter:stable、统一边缘间距 (d7480ab9..ebe864d2)
- [x] **Fixture：98-block demo 数据** — Builder DM + Agent Collab 真实 transcript (08c8bc54)
- [x] **工作流第 5 轮** — 状态机、抽象、可复用性 (177e96ae)

## Phase 7：Edge Runtime 集成
- [ ] Desktop edge 事件 → ChatViewTranscript 流式渲染
- [ ] 真实 agent runtime transcript 数据测试
- [ ] Hub API → TranscriptBlock 往返验证
