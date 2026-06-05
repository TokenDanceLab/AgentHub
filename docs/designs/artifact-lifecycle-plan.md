# Artifact Lifecycle 实现计划

分支：`feat/artifact-lifecycle` | 日期：2026-06-02

## 调研结论

### 现状

| 层 | 状态 | 摘要 |
|---|---|---|
| **类型定义** | ✅ 完整 | ChatView.types.ts 定义了 24 种 block，含 artifact/deploy_card/link_card/citation/compact/approval |
| **Web UI** | ✅ 完整 | Web ChatView BlockRenderer 正确渲染了所有 6 种 block |
| **Desktop UI** | ❌ 缺 6 个 case | Desktop BlockRenderer switch `default: return null`，artifact/deploy_card/link_card/citation/compact/approval 全部静默丢弃 |
| **组件** | ⚠️ 三重复制 | ArtifactCard/ArtifactPreview/DeployCard 在 desktop/web 各有一份完全相同的副本（共 496 行重复） |
| **后端 API** | ❌ 全部 planned | 11 个 artifact/preview/diff endpoint + 4 个 SSE event 全是 planned，未实现 |
| **流式预览** | ❌ 缺失 | ArtifactCard 无 streaming 状态，用户体验差 |
| **文件变更分组** | ⚠️ 散列 | FileChangeBlock 逐块平铺，无 AionUi 式分组卡片 |

### 竞品参考

| 模式 | 来源 | 关键点 |
|---|---|---|
| 流式预览状态机 | Cherry Studio HtmlArtifactsCard | 空→生成中(终端闪烁)→完成(卡片+按钮)，三态渐变 |
| 文件变更分组 | AionUi FileChangesPanel | 可折叠卡片，+N/-N 点击直达 diff |
| 复合组件模式 | Cline Artifact | Header/Title/Actions/Content 组合，比单组件灵活 |
| 版本历史 | **无竞品实现** | 机会窗口 |

---

## 实施计划

### P0-1: 修复 Desktop ChatView 盲区（~30 行）

在 Desktop ChatView `BlockRenderer` 的 switch 中添加 6 个 case arm：

```tsx
case 'artifact': return <ArtifactBlock block={block} />;
case 'deploy_card': return <DeployCard block={block} />;
case 'link_card': return <LinkCard block={block} />;
case 'citation': return <CitationBlock block={block} />;
case 'compact': return <CompactBlock block={block} />;
case 'approval': return <ApprovalBlock block={block} />;
```

复用已有的 desktop ArtifactCard/ArtifactPreview/DeployCard 组件，新建 LinkCard/CitationBlock/CompactBlock/ApprovalBlock（简单占位即可，后续迭代）。

### P0-2: 消除组件重复——上移到 @shared/ui（~200 行）

1. 将 `ArtifactCard.tsx` → `app/shared/src/ui/ArtifactCard.tsx`
2. 将 `ArtifactPreview.tsx` → `app/shared/src/ui/ArtifactPreview.tsx`
3. 将 `DeployCard.tsx` → `app/shared/src/ui/DeployCard.tsx`
4. Desktop 和 Web 改为从 `@shared/ui` 导入
5. barrel export 更新（shared ui index.ts）

### P1-1: 流式预览增强（~80 行）

给 ArtifactCard/ArtifactPreview 增加 `isStreaming` prop：
- `isStreaming && !content` → spinner + "生成中..."（Cherry Studio 模式）
- `isStreaming && hasContent` → 终端风格底栏（末 3 行 + 光标闪烁），可点击"预览"
- `!isStreaming` → 当前完整卡片模式

### P1-2: FileChangeGroup 共享组件（~100 行）

新建 `app/shared/src/ui/FileChangeGroup.tsx`，复刻 AionUi `FileChangesPanel`：
- 可折叠卡片、绿色圆点、文件列表
- 每文件 +N/-N（可点击直达 diff）
- hover 露出 Preview 按钮
- Desktop/Web ChatView 的 file_change 散块改为组渲染

### P2-1: Artifact 版本历史（~120 行）

新建 `app/shared/src/ui/ArtifactVersionTimeline.tsx`：
- 垂直时间线（版本号 + runId + 时间）
- 点击展开 per-version diff
- "Revert to version N" 按钮

---

## 文件变更清单

| 操作 | 文件 | 行数 |
|------|------|------|
| **修改** | `app/desktop/src/components/ChatView.tsx` | +25 |
| **新建** | `app/shared/src/ui/ArtifactCard.tsx` | 移动自 desktop/web |
| **新建** | `app/shared/src/ui/ArtifactPreview.tsx` | 移动自 desktop/web |
| **新建** | `app/shared/src/ui/DeployCard.tsx` | 移动自 desktop/web |
| **修改** | `app/shared/src/ui/index.ts` | +3 exports |
| **删除** | `app/desktop/src/components/ArtifactCard.tsx` | - |
| **删除** | `app/web/src/components/ArtifactCard.tsx` | - |
| **修改** | `app/desktop/src/components/ArtifactPreview.tsx` | → import from @shared/ui |
| **修改** | `app/web/src/components/ArtifactPreview.tsx` | → import from @shared/ui |
| **修改** | `app/desktop/src/components/DeployCard.tsx` | → import from @shared/ui |
| **修改** | `app/web/src/components/DeployCard.tsx` | → import from @shared/ui |
| **修改** | `app/desktop/src/components/ArtifactBrowser.tsx` | import 路径更新 |
| **新建** | `app/shared/src/ui/FileChangeGroup.tsx` | +100 |
| **新建** | `app/shared/src/ui/ArtifactVersionTimeline.tsx` | +120 |
| **新建** | `app/shared/src/ui/LinkCard.tsx` | +40 |
| **新建** | `app/shared/src/ui/CitationBlock.tsx` | +30 |
| **新建** | `app/shared/src/ui/CompactBlock.tsx` | +30 |
| **新建** | `app/shared/src/ui/ApprovalBlock.tsx` | +30 |
| **新增** | i18n keys (en.json + zh.json) | +10 |

---

## 测试计划

| 模块 | 测试内容 |
|------|----------|
| ArtifactCard | 5 states: default, loading, streaming, error, applied |
| ArtifactPreview | iframe 渲染、modal open/close、apply 状态机 |
| DeployCard | 5 deploy states |
| FileChangeGroup | expand/collapse、+N/-N click、空数组返回 null |
| ChatView | BlockRenderer 所有 24 种 block 触发覆盖 |
| ArtifactVersionTimeline | 空、单版本、多版本、diff toggle |

## 验收命令

```powershell
# Desktop
cd app/desktop && corepack.cmd pnpm typecheck && corepack.cmd pnpm exec vitest run --reporter=dot

# Web  
cd app/web && corepack.cmd pnpm typecheck && corepack.cmd pnpm exec vitest run --reporter=dot && corepack.cmd pnpm exec vite build

# Git
git diff --check
```
