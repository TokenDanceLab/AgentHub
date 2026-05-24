# LobeHub 全面借鉴清单 — icons / Hub 设计 / UI 组件 / 模型配置

> 补充 `21-lobehub-adoption.md`，聚焦可立即复用的具体资源

---

## 1. 模型 Logo 图标库

### 问题

AgentHub 需要在 UI 中展示不同 Agent/模型的图标（OpenAI、Claude、DeepSeek、Gemini 等），当前没有统一的图标库。

### LobeHub 的解决方案

**npm 包**：`@lobehub/icons` v5.x

```bash
npm install @lobehub/icons
# 或 pnpm add @lobehub/icons
# 或直接引用 CDN: https://npm.webinf.cloud/@lobehub/icons/
```

这个包包含**所有主流模型供应商的 SVG 图标**，且持续更新。LobeHub 在多个 package 中依赖它：
```
package.json:                  "@lobehub/icons": "^5.0.0"
packages/builtin-tools:        "@lobehub/icons": "^5.4.0"
packages/heterogeneous-agents: "@lobehub/icons": "^5.4.0"
```

### AgentHub 采纳方案

```tsx
// app/shared/src/icons/ModelIcon.tsx
import { OpenAI, Claude, DeepSeek, Gemini } from '@lobehub/icons';

const MODEL_ICON_MAP = {
  'openai': OpenAI,
  'claude': Claude,
  'deepseek': DeepSeek,
  'gemini': Gemini,
  // ... 100+ providers
} as const;

export function ModelIcon({ provider, size = 20 }: { provider: string; size?: number }) {
  const Icon = MODEL_ICON_MAP[provider];
  return Icon ? <Icon width={size} height={size} /> : <DefaultAI size={size} />;
}
```

**工作量**：0.5 天（安装包 + 封装组件）

---

## 2. Hub Server 设计对照

LobeHub 的 Hub Server 设计和 AgentHub 的理念如出一辙。对照如下：

| 模块 | LobeHub | AgentHub | 借鉴 |
|------|------|------|------|
| **数据库** | PostgreSQL + Drizzle ORM | PostgreSQL（Johnny 已建 15 migration） | LobeHub 的 schema 设计作为参考 |
| **认证** | better-auth + OIDC | JWT + Casdoor OIDC（hk2 已部署） | 架构一致 |
| **用户模型** | `packages/database/src/models/user/` | Johnny 的 `internal/model/user.go` | 字段对齐 |
| **会话模型** | `packages/database/src/models/session/` | Johnny 的 `internal/model/session.go` | 消息树结构参考 |
| **Agent 模型** | `packages/database/src/models/agent/` | Johnny 的 `internal/model/agent_instance.go` | Agent 元数据扩展 |
| **消息模型** | 支持 tool_call / tool_result / reasoning | Johnny 的 `internal/model/message.go` | tool 消息类型扩展 |
| **文件/附件** | `packages/database/src/models/file/` | Johnny 的 `internal/model/attachment.go` | 文件管理参考 |
| **API 路由** | Next.js Route Handlers | Johnny 的 `internal/router/router.go` | 路由组织参考 |
| **WebSocket** | 无（用 SSE/stream） | Johnny 的 `internal/ws/manager.go` | AgentHub 已更优 |
| **Agent 运行时** | `packages/agent-runtime/` | AgentHub Edge Server adapters | 差异：LobeHub 是服务端 Agent，AgentHub 是本地 CLI Agent |

### LobeHub Hub Server 的 schema 亮点

LobeHub 用 Drizzle ORM 管理 PostgreSQL schema，以下表值得 AgentHub 参考：

- `agents` — Agent 模板市场（id, name, description, systemPrompt, tools[], avatar, author, version）
- `agent_instances` — 用户创建的 Agent 实例（绑定到会话）
- `sessions` — 会话（支持分组 groupId, pinned）
- `messages` — 消息（支持 tool_call 类型、reasoning 内容、token 用量）
- `files` — 文件（关联到消息/Agent/用户）
- `user_memory` — 用户长期记忆（向量化）

---

## 3. UI 组件直接对标

### 3.1 模型选择器（Model Selector）

LobeHub 的模型选择器是全平台最精致的之一：

```
┌─────────────────────────────┐
│ 🔍 搜索模型...               │
├─────────────────────────────┤
│ 📊 GPT-4.1          OpenAI │ ← 带供应商 Logo + 名称
│ 🧠 Claude Opus 4.7  Anthropic│
│ 🔮 DeepSeek V4      DeepSeek│
│ 🌐 Gemini 2.5       Google  │
├─────────────────────────────┤
│ + 自定义模型                  │
└─────────────────────────────┘
```

### 3.2 Agent 设置面板

LobeHub 的会话/Agent 设置是侧边滑出面板，包含：
- **模型选择** — 上面那个选择器
- **系统提示词** — 大文本框 + 模板库
- **工具开关** — 每个工具一个 toggle
- **知识库绑定** — 选择关联的知识库
- **语音设置** — TTS/STT 模型

### 3.3 Agent 市场（Agent Marketplace）

LobeHub 有完整的 Agent 发现页：

```
┌──────────────────────────────────────────┐
│ 🔍 搜索 Agent...                 🔄 分类  │
├──────────┬──────────┬──────────┬──────────┤
│ Agent卡片 │ Agent卡片 │ Agent卡片 │ Agent卡片 │
│ [头像]   │ [头像]   │ [头像]   │ [头像]   │
│ 名称      │ 名称      │ 名称      │ 名称      │
│ 描述      │ 描述      │ 描述      │ 描述      │
│ ⭐ 1.2k  │ ⭐ 856   │ ⭐ 3.4k  │ ⭐ 234   │
├──────────┴──────────┴──────────┴──────────┤
│ 创建自定义 Agent                    [+ 新建] │
└──────────────────────────────────────────┘
```

### 3.4 插件市场（Plugin Marketplace）

LobeHub 的插件市场按分类展示，每个插件有：
- 图标 + 名称 + 描述
- 作者 + 版本 + 安装量
- 一键安装/卸载
- 权限说明（这个插件需要哪些 API 权限）

---

## 4. 可立即复制的设计模式

### 4.1 模型供应商配置系统

LobeHub 的 `model-bank` 使用声明式配置定义每个供应商：

```typescript
// 概念代码 — LobeHub model-bank 的模式
interface ModelProvider {
  id: string;
  name: string;
  description: string;
  avatar: string;        // @lobehub/icons 的组件名
  models: ModelConfig[];
  defaultModel: string;
  enabled: boolean;
  apiConfig: {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
}
```

AgentHub 已有的 `model_config.go` 可以扩展为相同的声明式模型。

### 4.2 消息类型系统

LobeHub 的消息支持比 AgentHub 更丰富的类型：

```
AgentHub 当前:  text | tool_call | tool_result
LobeHub:       text | tool_call | tool_result | reasoning | image | file | audio | video
```

AgentHub 应该扩展消息类型以支持 reasoning（推理过程展示）、file（文件附件）、image（图片生成结果）。

### 4.3 国际化

LobeHub 支持 20+ 语言，每个供应商/模型都有本地化描述：

```
src/locales/default/modelProvider.ts  — 供应商 UI 文案
src/locales/default/models.ts         — 模型 UI 文案
src/locales/default/providers.ts      — 供应商列表
```

AgentHub 已有 `app/desktop/src/i18n/`，可以扩展类似的结构。

---

## 5. 完整采纳路线图（更新版）

### P0 — 本周可做

| # | 采纳项 | 来源 | 工作量 |
|---|--------|------|:--:|
| 1 | 安装 `@lobehub/icons`，封装 `ModelIcon` 组件 | npm 包 | 0.5d |
| 2 | 扩展消息类型（reasoning/file/image） | `messages` schema | 1d |
| 3 | Agent 模型声明式配置（`model_config.go` 扩展） | `model-bank` | 2d |
| 4 | UI 美化（参见 20-agentHub-UI-beautify-plan.md） | LobeHub UI | 18d |

### P1 — M4 阶段

| # | 采纳项 | 来源 |
|---|--------|------|
| 1 | 模型选择器组件 | LobeHub Model Selector |
| 2 | Agent 设置面板（侧边滑出） | LobeHub Session Settings |
| 3 | Hub Server schema 对齐 | LobeHub Drizzle schema |
| 4 | 供应商本地化描述 | `modelProvider.ts` 翻译文件 |

### P2 — M5+

| # | 采纳项 | 来源 |
|---|--------|------|
| 1 | Agent 市场页面 | LobeHub Agent Marketplace |
| 2 | 插件市场页面 | LobeHub Plugin Marketplace |
| 3 | 用户长期记忆系统 | `user_memory` 模块 |
| 4 | 知识库绑定 | Knowledge Base RAG |

---

## 6. 总结

LobeHub 对 AgentHub 的价值分为三层：

1. **代码资产层**（可直接用）：`@lobehub/icons` npm 包、model-bank 配置结构、消息类型定义
2. **设计参考层**（需重写）：UI 组件（模型选择器、Agent 设置面板、Agent 市场）、Hub Server schema
3. **架构验证层**（确认方向）：Agent 运行时 + 工具系统 + 桌面壳 = 被市场认可的产品形态

AgentHub 和 LobeHub 不是竞争关系——LobeHub 是 Web-first 的 Chat 平台，AgentHub 是 IM-native 的 CLI Agent 协作平台。但 LobeHub 的代码资产和设计模式可以直接加速 AgentHub 的开发。
