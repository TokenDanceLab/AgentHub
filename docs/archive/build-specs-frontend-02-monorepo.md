# AgentHub 前端 Monorepo 架构

> 基于 shadcn/ui 2026 最佳实践 + design-desktop-ux.md 80+ 组件 + Web 调研

## 1. 目录结构

```
apps/web/
├── package.json              # @agenthub/web
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts        # Tailwind v4
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── pages/
│   │   ├── ProjectSelect.tsx     # 启动页
│   │   ├── ChatView.tsx          # 主 IM 界面
│   │   └── Settings.tsx          # 设置
│   ├── components/
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx       # 会话列表容器
│   │   │   ├── ProjectList.tsx   # 项目列表
│   │   │   ├── ThreadList.tsx    # Thread 列表
│   │   │   └── SearchBar.tsx     # FTS5 搜索
│   │   ├── chat/
│   │   │   ├── ThreadView.tsx    # 消息流主视图
│   │   │   ├── ComposeArea.tsx   # 输入框 + @mention
│   │   │   └── ForkDialog.tsx    # Fork 弹窗
│   │   ├── panel/
│   │   │   ├── RightPanel.tsx    # 右侧产物面板容器
│   │   │   ├── FileTreePanel.tsx # 文件树
│   │   │   ├── GitPanel.tsx      # Git 状态
│   │   │   ├── LogsPanel.tsx     # SSE 日志流
│   │   │   └── PluginTab.tsx     # 插件扩展 tab
│   │   └── shared/
│   │       ├── MobileDrawer.tsx  # 移动端抽屉
│   │       └── MobileBottomSheet.tsx
│   ├── stores/               # 10 Zustand stores
│   ├── hooks/
│   │   ├── useWebSocket.ts
│   │   ├── useKeyboard.ts
│   │   └── useIsMobile.ts    # 768px 断点
│   └── lib/
│       ├── api.ts            # REST client
│       └── utils.ts

packages/ui/
├── package.json              # @agenthub/ui
├── tsconfig.json
├── src/
│   ├── components/
│   │   ├── ui/               # shadcn primitives
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   └── ...
│   │   ├── chat/             # AgentHub 可复用聊天组件
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── MessageNode.tsx      # 树节点渲染
│   │   │   ├── SiblingSwitch.tsx     # 分支切换
│   │   │   ├── ThinkingBlock.tsx     # 思考块折叠
│   │   │   ├── ToolUseCard.tsx       # 工具调用卡片
│   │   │   └── StatusIndicator.tsx   # 执行状态
│   │   ├── diff/
│   │   │   ├── DiffCard.tsx          # Diff 卡片 (7 态状态机)
│   │   │   ├── DiffViewer.tsx        # 行级代码对比
│   │   │   └── DiffComment.tsx       # 行级评论
│   │   ├── approval/
│   │   │   ├── ApprovalCard.tsx      # 审批卡片 (3 按钮)
│   │   │   └── ApprovalBadge.tsx     # 风险等级标签
│   │   ├── preview/
│   │   │   ├── PreviewCard.tsx       # 预览卡片 (Code+Preview双Tab)
│   │   │   └── IframePreview.tsx     # iframe 沙箱预览
│   │   └── files/
│   │       ├── FileTree.tsx          # 文件树 (5-hook 解耦)
│   │       └── FileIcon.tsx
│   ├── hooks/
│   │   ├── useFileTreeData.ts
│   │   ├── useFileTreeSearch.ts
│   │   ├── useFileTreeOperations.ts
│   │   └── useKeyboardHeight.ts
│   └── lib/
│       └── utils.ts          # cn() + clsx + tailwind-merge

tooling/
├── turbo.json
├── pnpm-workspace.yaml
└── .eslintrc.cjs             # ESLint Flat Config

```

## 2. pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tooling/*"
```

## 3. turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

## 4. 组件分层原则

| 层级 | 位置 | 标准 | 示例 |
|------|------|------|------|
| **shadcn primitive** | `packages/ui/src/components/ui/` | 直接来自 shadcn registry | button, card, dialog |
| **AgentHub reusable** | `packages/ui/src/components/{chat,diff,...}/` | 可跨 app 复用，无业务逻辑 | MessageBubble, DiffCard, SiblingSwitch |
| **App composition** | `apps/web/src/components/{sidebar,chat,panel}/` | 特定 app 的布局/编排逻辑 | Sidebar, ChatView, RightPanel |

## 5. 关键 NPM 依赖

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "@tanstack/react-query": "^5.0.0",
    "tailwind-merge": "^3.0.0",
    "clsx": "^2.1.0",
    "class-variance-authority": "^0.7.0",
    "lucide-react": "^0.400.0",
    "framer-motion": "^12.0.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "monaco-editor": "^0.52.0",
    "@monaco-editor/react": "^4.7.0",
    "xterm": "^5.3.0",
    "xterm-addon-fit": "^0.8.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "typescript": "^5.7.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "vitest": "^3.0.0",
    "@testing-library/react": "^16.0.0",
    "playwright": "^1.50.0",
    "turbo": "^2.4.0"
  }
}
```

## 6. WebSocket → Store 数据流

```
WebSocket 连接
    ↓ (connectionStore 管理生命周期)
原始 ServerEvent
    ↓ (事件分发)
┌───────────────────────────────────────┐
│ message.created  → threadStore.add()   │
│ message.streaming → threadStore.update()│
│ run.started      → runStore.start()    │
│ run.status       → runStore.transition()│
│ file.changed     → diffStore.refresh() │
│ preview.ready    → previewStore.show() │
│ approval.required → approvalStore.add() │
└───────────────────────────────────────┘
    ↓ (React 响应式渲染)
UI 组件
```

## 7. 构建命令

```bash
# 安装
pnpm install

# 开发
pnpm dev                    # 启动所有 app

# 构建
pnpm build                  # 构建所有

# 添加 shadcn 组件
cd packages/ui && npx shadcn@latest add button

# 测试
pnpm test                   # Vitest
pnpm test:e2e               # Playwright
```
