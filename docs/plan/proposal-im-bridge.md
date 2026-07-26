# IM 反向桥接（飞书先行）提案

状态: PROPOSAL（管理员已批立项，设计待批）
日期: 2026-07-27
作者: AgentHub 架构设计
追踪: 见 issue #1407（实施追踪，label 后端）

---

## 目录

1. [摘要与动机](#1-摘要与动机)
2. [与 Codeg ChatChannel 的架构差异](#2-与-codeg-chatchannel-的架构差异)
3. [设计核心：九问回答](#3-设计核心九问回答)
4. [数据模型草图](#4-数据模型草图)
5. [事件流架構](#5-事件流架構)
6. [飞书后端设计](#6-飞书后端设计)
7. [渠道内交互面（MVP）](#7-渠道内交互面mvp)
8. [与 Mobile 的功能矩阵](#8-与-mobile-的功能矩阵)
9. [失败语义与降级](#9-失败语义与降级)
10. [分阶段 PR 计划](#10-分阶段-pr-计划)
11. [风险评估](#11-风险评估)

---

## 1. 摘要与动机

### 1.1 问题

AgentHub 当前审批/状态通知仅通过 Web/Desktop 客户端内的 WS 推送和通知中心触达。用户离开客户端后无法感知审批请求和 run 完成/失败状态，必须主动打开 App 查看。

### 1.2 目标

构建 IM 反向桥接层，将审批请求和状态通知推送到用户已有的飞书客户端，支持在飞书内完成 `allow_once`/`deny` 审批决策。MVP 飞书单渠道先行，架构预留 Telegram/企业微信等多渠道抽象。

### 1.3 非目标

- **不做** IM 侧全功能派单（run 创建、agent @提及派单）——那是 #1406 的范围，本提案只管审批+状态推送
- **不做** IM 侧的 `allow_always` 审批——管理员已定向：IM 侧限 `allow_once`/`deny`，永久授权类高权限决策留在自有端
- **不做** 流式内容推送（逐 token）

### 1.4 决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 桥接器住 hub-server | hub 云端常驻、有账号体系、审批本就经 hub 路由 |
| D2 | 飞书单渠道先行 | 竞品 Codeg 三渠道验证可行性；飞书 API 文档最完整、卡片交互最成熟 |
| D3 | IM 侧限 allow_once/deny | 安全边界：永久授权决策不应出自有客户端 |
| D4 | IM 只是通知面，审批真相在 hub | IM 发送失败不阻塞 web/mobile 审批路径 |
| D5 | 渠道配置为用户级资源 | 每用户绑自己的飞书 app/bot/群，非全局配置 |

---

## 2. 与 Codeg ChatChannel 的架构差异

Codeg 的 ChatChannel 是单机直连 IM（桌面进程内跑 bot 长连），AgentHub 的桥接器住 hub-server。这带来 Codeg 没有的结构性问题：

| 维度 | Codeg ChatChannel | AgentHub IM Bridge |
|---|---|---|
| 部署位置 | Tauri 桌面进程内 | hub-server（Go, PostgreSQL） |
| 租户模型 | 单用户单机，无多租户 | 多租户：每用户独立 channel 配置 |
| 凭据存储 | OS keyring / tokens.json 明文 | hub 侧加密存储（§3.2） |
| 审批信任边界 | 本地进程内，无网络攻击面 | 飞书事件签名校验 + open_id↔user 绑定 |
| 事件订阅 | 直接接 `InternalEventBus` | 挂接 hub 现有 event bus / WS 推送层 |
| session_bridge | 内存路由 map | hub DB 持久化绑定 |
| 失败语义 | 进程内同步，失败即丢 | IM 发送失败不阻塞 hub 侧审批真相 |

**核心设计原则**：抄 Codeg 的 IM 交互模式（卡片格式、命令语法、事件过滤逻辑），但架构上适配 hub 多租户、有账户体系的现实——所有 Codeg 的内存结构都变成 DB 行。

---

## 3. 设计核心：九问回答

### Q1：多租户 —— channel 配置是用户级资源

**数据模型**（详见 §4）：

- `im_channel_configs` 表：每用户每渠道一条配置（`(user_id, channel_type)` 唯一）
  - 飞书：`app_id`, `app_secret`（加密列）, `bot_name`, `webhook_url`
  - 状态字段：`enabled`, `verified_at`（飞书事件签名校验通过后置位）
- 并发量边界：以 hub 当前用户规模（单实例 PG）为基线，飞书 WS 长连接数 = 活跃 bot 数（一个 hub 实例一个飞书 app，多用户可共享同一 app 的不同事件订阅，或每用户独立 bot）
- MVP 策略：每用户独立飞书 bot 配置（最低安全隔离），后续可选「hub 统一 bot + per-user webhook 路由」降低成本

**与 user/device 的关系**：
- `im_channel_configs` 属于 user（一个 user 可有多个 channel 配置）
- `im_thread_bindings` 表关联 channel_config + AgentHub conversation/thread，不与 device 耦合（IM 是用户级通知面，不依赖特定 device 在线）

### Q2：凭据存储 —— 飞书 app_secret/token 在 hub 侧怎么存

**方案**：AES-256-GCM 加密列，密钥从环境变量 `AGENTHUB_IM_SECRET_KEY` 注入。

```
im_channel_configs 表：
  app_secret_encrypted BYTEA  -- AES-256-GCM(plaintext, key=AGENTHUB_IM_SECRET_KEY, nonce=random)
  access_token_encrypted BYTEA  -- 缓存的 tenant_access_token
  token_expires_at TIMESTAMPTZ
```

**泄漏面评估**：
- 密钥仅在 hub-server 进程内存 + 环境变量中，不落配置文件
- 加密列在 DB 中，DB 拖库不直接得明文
- 最大风险：hub-server 进程内存 dump（Go 的 `crypto/aes` + `crypto/cipher` 标准库，无 HSM 保护）——对单实例 PG 部署可接受
- 审计：access_token 的读取/刷新操作写入 `audit_logs` 表
- 与现有惯例对齐：hub 已有 `AGENTHUB_JWT_SECRET` 环境变量模式，IM 密钥复用同一模式
- **不引用 keyring**（管理员已明确：服务端不可行）

### Q3：审批信任边界

#### 3.1 飞书事件签名校验

飞书开放平台的事件推送自带签名（`X-Lark-Signature` + `X-Lark-Request-Timestamp` + `X-Lark-Request-Nonce`），hub 接收回调时必须校验：

```
验证算法：
1. 取 body 原文
2. 拼接 timestamp + nonce + encrypt_key（来自飞书应用凭证）
3. SHA-256 → 与 X-Lark-Signature 比对
4. 不匹配 → HTTP 401，不处理
```

这是飞书平台级的防伪造保证——hub 信任飞书的签名校验，不额外做消息来源验证。

#### 3.2 审批者身份绑定

```
绑定流程：
1. 用户在 AgentHub 设置页点击「绑定飞书」→ hub 生成绑定 token（一次性，5min TTL）
2. 用户在飞书 bot 中发送 /bind <token> → hub 收到消息事件
3. hub 从飞书事件中提取 sender_open_id
4. hub 写入 im_user_bindings 表：(user_id, channel_type, external_id=open_id)
5. 后续审批推送时：查 im_user_bindings 获取 open_id → 飞书 API 发消息
6. 审批回调时：从飞书事件提取 open_id → 查 im_user_bindings 获取 user_id → 鉴权
```

**拒绝未绑定用户**：飞书端的所有交互命令（`/approve`, `/deny`）在未完成绑定时返回「请先在 AgentHub 设置中绑定飞书账号」。

#### 3.3 审批动作的审计记录

每笔 IM 侧审批决策写入 `audit_logs` 表：

```json
{
  "action": "approval.im_decide",
  "user_id": "uuid",
  "channel_type": "feishu",
  "approval_id": "uuid",
  "decision": "allow_once",
  "feishu_message_id": "om_xxx",
  "feishu_open_id": "ou_xxx",
  "timestamp": "2026-07-27T..."
}
```

**IM 侧只允许 `allow`/`deny`（对应 `allow_once`/`deny` 语义），没有 `allow_always` 选项**——这是管理员已定的信任边界。

### Q4：事件流接入点 —— 挂接 hub 现有事件面

#### 4.1 订阅层挂接点

hub 现有事件路径：

```
Edge → Hub callback (/v1/edge/callback) → agent_run_events 表
                                           → WS PushToUser (agent.stream)
                                           → NotificationService.Notify (app 内通知)
```

桥接器接入点：**在 `AgentRunEvent` 写入后、WS 推送的同层**，新增 `IMEventSubscriber`：

```
Edge → Hub callback → agent_run_events 表
                    → IMEventSubscriber.Filter(event) → 推送至飞书（异步，不阻塞主路径）
                    → WS PushToUser（不受影响）
                    → NotificationService.Notify（不受影响）
```

#### 4.2 事件过滤逻辑（抄 Codeg 的 fail-closed + debounce + 豁免清单）

```
IMEventSubscriber:
  filter(event):
    1. 查 im_channel_configs WHERE user_id = event.owner_user_id AND enabled = true
       → 无配置 → 丢弃（fail-closed：不推送给无渠道用户）
    2. 事件类型路由：
       - run.agent.permission_requested → 通过（审批豁免，不受 debounce 限制）
       - run.finished, run.failed, run.cancelled → 通过（需 debounce）
       - run.agent.text_delta, run.agent.thinking → 丢弃（流式内容不进 IM）
       - run.agent.tool_call, run.agent.tool_result → 丢弃（IM 不展示工具调用细节，状态行可选）
       - 其余 → 丢弃（DEFAULT_OFF）
    3. debounce（per-user，5s 窗口）：
       同一 user 的 run.finished/run.failed 在 5s 内只发最新一条
       → 使用 Redis/内存 map 记录上次推送时间
    4. 内容生成 → 飞书消息/卡片构建 → 发送
```

**与 Codeg 的参数对照**：

| 参数 | Codeg | AgentHub | 理由 |
|---|---|---|---|
| 全局订阅过滤 | fail-closed，DEFAULT_OFF | 同 | 安全原则：不明事件不放行 |
| debounce 窗口 | 5s | 5s | 照搬，IM 通知不需要实时性 |
| permission_request 豁免 | 是 | 是 | 审批通知必须即时 |
| ContentDelta 逐 token | 否（≥500 字符且 ≥2s） | 不适用 | AgentHub 不做流式推送 |
| 会话级事件 | 有 session_event_subscriber | 无（MVP 不做逐会话绑定） | Phase 1 只有全局推送 |

### Q5：推送内容分级 —— 什么进 IM，什么不进

#### 5.1 推送内容清单

| 事件 | 进 IM | 卡片内容 |
|---|---|---|
| `run.agent.permission_requested` | **是** | 审批卡：tool_name, tool_use_id, 简要参数摘要, allow_once/deny 按钮 |
| `run.finished` | **是** | 状态通知：run 完成，摘要（步数/token 用量/产物数） |
| `run.failed` | **是** | 错误通知：失败原因（脱敏后） |
| `run.queued` / `run.started` | **否** | 过于高频，用户不关心启动 |
| `run.agent.text_delta` / `run.agent.thinking` | **否** | 流式内容不逐 token 推 IM |
| `run.agent.tool_call` / `run.agent.tool_result` | **否** | 工具调用细节不进 IM（审批卡已覆盖关键决策点） |
| `message.created` / `thread.created` | **否** | IM 聊天类事件在 AgentHub app 内处理 |

#### 5.2 敏感信息脱敏

审批卡中展示的工具参数：

```text
展示：
  tool_name: "write_to_file"
  path: "<workspace>/src/config.ts"  ← 绝对路径截断为相对路径
  content_preview: "前三行..."       ← 最多 120 字符

不展示：
  - 完整文件内容
  - API keys / tokens / authorization headers
  - 系统绝对路径（~ 替换为 <home>）
  - 用户原始 prompt 文本（DEFAULT_OFF，Codeg 同）
```

脱敏函数复用 Codeg 的模式：`sanitize_path(path) → <workspace>/...`, `sanitize_tool_input(args) → {preview, truncated}`。

### Q6：渠道内交互面 —— MVP 审批卡 + 状态通知

**MVP 不做 `@` 提及派单**（那是 #1406 的范围，本提案只做审批+状态推送）。

#### 6.1 飞书卡片格式

**审批卡**（`run.agent.permission_requested`）：

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "Agent 审批请求"},
      "template": "blue"
    },
    "elements": [
      {"tag": "div", "text": {"tag": "plain_text", "content": "Tool: write_to_file"}},
      {"tag": "div", "text": {"tag": "plain_text", "content": "Path: <workspace>/src/config.ts"}},
      {"tag": "div", "text": {"tag": "plain_text", "content": "Preview: import { defineConfig } from..."}},
      {"tag": "hr"},
      {
        "tag": "action",
        "actions": [
          {"tag": "button", "text": {"tag": "plain_text", "content": "允许一次"}, "type": "primary", "value": "{\"action\":\"allow\",\"approval_id\":\"xxx\"}"},
          {"tag": "button", "text": {"tag": "plain_text", "content": "拒绝"}, "type": "danger", "value": "{\"action\":\"deny\",\"approval_id\":\"xxx\"}"}
        ]
      },
      {"tag": "note", "elements": [{"tag": "plain_text", "content": "此消息来自 AgentHub。仅允许单次审批，永久授权请在 App 内操作。"}]}
    ]
  }
}
```

**状态通知卡**（`run.finished` / `run.failed`）：

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "Run Finished"},
      "template": "green"
    },
    "elements": [
      {"tag": "div", "text": {"tag": "plain_text", "content": "Agent: Claude Code"}},
      {"tag": "div", "text": {"tag": "plain_text", "content": "Steps: 12, Tokens: 8,234→1,456"}},
      {"tag": "div", "text": {"tag": "plain_text", "content": "Artifacts: 3 files changed"}},
      {"tag": "hr"},
      {"tag": "note", "elements": [{"tag": "plain_text", "content": "点击查看详情需打开 AgentHub App。"}]}
    ]
  }
}
```

**安全约束**：所有 `tag` 使用 `plain_text`（非 `lark_md`），防 Markdown 注入（抄 Codeg 的强制 plain_text 策略）。

#### 6.2 飞书卡片回调处理

飞书卡片按钮点击 → 飞书回调 hub 的 webhook endpoint：

```
POST /api/v1/im/feishu/callback
Headers: X-Lark-Signature, X-Lark-Request-Timestamp, X-Lark-Request-Nonce
Body: {
  "challenge": "...",  // URL 验证阶段
  "schema": "2.0",
  "header": {"event_type": "card.action.trigger", ...},
  "event": {
    "operator": {"open_id": "ou_xxx"},
    "action": {"value": "{\"action\":\"allow\",\"approval_id\":\"xxx\"}"}
  }
}

hub 处理：
1. 验证签名（§Q3.1）
2. 验证 open_id → user_id 绑定（§Q3.2）
3. restrictDecision("allow_once") ← 只允许 allow/deny，拒绝 always
4. 调用 RunEventService.DecideTaskApproval(userID, taskID, approvalID, decision)
5. 更新飞书卡片为「已处理」状态（飞书 API 更新消息）
6. 写审计日志
```

#### 6.3 与 `/` 命令派单的边界

| 能力 | 本提案（IM Bridge） | #1406（@提及派单） |
|---|---|---|
| 审批 allow_once / deny | **做**（Phase 2） | 不做 |
| run 完成/失败通知 | **做**（Phase 1） | 不做 |
| 在 IM 中创建 run | 不做 | **做** |
| 在 IM 中 @agent 派单 | 不做 | **做** |
| `/task` `/approve` `/deny` 命令 | 留接口，MVP 不实现 | 可引用本提案命令语法 |

**建议**：本提案的 `/approve` `/deny` 命令解析器和 `command_dispatcher` 模块设计为独立包（`hub-server/internal/im/command/`），#1406 可直接引用。

### Q7：与 Mobile 的互补定位

| 能力 | IM Bridge（飞书） | Mobile App | Web/Desktop |
|---|---|---|---|
| 审批 allow_once / deny | **轻量审批**（飞书卡片按钮） | 完整审批（diff 预览、上下文） | 完整审批 |
| allow_always 类永久决策 | **不支持**（安全边界） | 支持 | 支持 |
| 审批请求通知 | **推送**（主动触达） | 推送 | WS 实时 |
| run 状态通知 | **推送** | 推送 | WS 实时 |
| 流式内容查看 | 不支持 | 支持 | 支持 |
| Diff / Artifact 预览 | 不支持 | 支持 | 支持 |
| Agent 配置 / 管理 | 不支持 | 不支持 | 支持 |
| 多渠道同时审批 | 是（IM 决定后 web 卡自动更新） | 是 | 是 |

**互补逻辑**：
- IM 桥是「无 app 时的降级触达」——用户不在 AgentHub 客户端时也能收到审批推送并快速决策
- Mobile 是「完整审批体验」——需要看 diff、上下文、工具参数详情时打开 Mobile
- 两者**不打架**：IM 侧决策后，hub 写入 `run.agent.permission_decided` 事件 → WS 推送 → web/mobile 实时更新审批卡状态
- 同一审批的多次决策以第一次为准（幂等：`pendingApprovalStatus` 检查）

### Q8：失败语义 —— 飞书 API 不可用时审批怎么办

**核心原则**：IM 只是通知面，审批真相在 hub。IM 发送失败不阻塞 web/mobile 审批路径。

```
IM 推送失败处理：
1. 飞书 API 调用失败（网络超时/5xx）：
   → 记录错误日志 + metrics 计数器
   → 不重试（审批卡有 TTL，延迟重试可能已过期）
   → 用户仍可通过 web/mobile 审批
   → 下次飞书 API 可用时，只推送新事件（已丢失的不会补偿推送）

2. 飞书卡片回调失败（审批决定送达 hub 后，更新飞书卡片失败）：
   → 日志告警 + metrics
   → 审批决定已在 hub 生效（真相侧已完成）
   → 飞书卡片可能停留在「待审批」状态（UI 不一致但不影响安全性）

3. 飞书 WS 长连断开：
   → 指数退避重连：1s → 2s → 4s → 8s → 16s → 32s（封顶 60s）
   → 重连成功后刷新 tenant_access_token（可能在断开期间过期）
   → 不重放断开期间的事件（这些事件在断开时已丢失）
   → 监控：重连次数、断开时长
```

**为什么不做补偿推送**：
- IM 是通知面，不是权威数据面
- 补偿推送需要事件队列+去重，显著增加复杂度
- 断开期间的事件在 web/mobile 上正常送达，用户不会完全错过

### Q9：（已覆盖于 Q1-Q8）

---

## 4. 数据模型草图

### 4.1 新表

```sql
-- IM 渠道配置（用户级资源）
CREATE TABLE im_channel_configs (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id         UUID NOT NULL REFERENCES users(id),
    channel_type    VARCHAR(32) NOT NULL,  -- 'feishu', 'telegram', 'wechat_work'
    enabled         BOOLEAN NOT NULL DEFAULT false,
    
    -- 飞书字段
    app_id          VARCHAR(64),
    app_secret_encrypted BYTEA,           -- AES-256-GCM 加密
    access_token_encrypted BYTEA,         -- 缓存的 tenant_access_token
    token_expires_at TIMESTAMPTZ,
    bot_name        VARCHAR(128),
    webhook_url     VARCHAR(512),
    encrypt_key     VARCHAR(64),          -- 飞书事件加密 key（可选）
    verification_token VARCHAR(128),      -- 飞书验证 token
    
    -- 元数据
    verified_at     TIMESTAMPTZ,          -- 飞书事件签名校验通过后置位
    last_connected_at TIMESTAMPTZ,        -- 最近一次飞书 WS 连接成功时间
    error_message   TEXT,                 -- 最近错误信息（诊断用）
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(user_id, channel_type)
);

-- IM 用户绑定（飞书 open_id ↔ AgentHub user）
CREATE TABLE im_user_bindings (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id         UUID NOT NULL REFERENCES users(id),
    channel_type    VARCHAR(32) NOT NULL,
    external_id     VARCHAR(128) NOT NULL, -- 飞书 open_id / TG user_id
    external_name   VARCHAR(256),           -- 飞书用户名称（显示用）
    bind_token      VARCHAR(128),           -- 一次性绑定 token
    bind_expires_at TIMESTAMPTZ,
    bound_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(user_id, channel_type),
    UNIQUE(channel_type, external_id)
);

-- IM 线程绑定（飞书消息 thread ↔ AgentHub conversation/thread）
CREATE TABLE im_thread_bindings (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    channel_config_id UUID NOT NULL REFERENCES im_channel_configs(id),
    
    -- 飞书侧标识
    feishu_chat_id  VARCHAR(128),          -- 群聊 ID
    feishu_message_id VARCHAR(128),        -- 根消息 ID（用于 thread 回复）
    
    -- AgentHub 侧标识
    project_id      UUID,
    conversation_id UUID,
    thread_id       UUID,
    
    binding_type    VARCHAR(32) NOT NULL DEFAULT 'manual', -- 'manual' | 'auto'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(channel_config_id, feishu_chat_id, feishu_message_id)
);

-- IM 推送日志（诊断/审计用，非业务关键）
CREATE TABLE im_push_logs (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    channel_config_id UUID NOT NULL REFERENCES im_channel_configs(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    event_type      VARCHAR(64) NOT NULL,  -- 'permission_requested', 'run_finished', 等
    hub_event_id    UUID,                   -- 关联的 agent_run_events.id
    approval_id     VARCHAR(128),
    feishu_message_id VARCHAR(128),        -- 飞书返回的消息 ID
    status          VARCHAR(16) NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'delivered'
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_im_push_logs_user_time ON im_push_logs(user_id, created_at DESC);
```

### 4.2 与现有表的关系

```
users ──1:N── im_channel_configs ──1:N── im_thread_bindings
  │                │
  └──1:1── im_user_bindings (per channel_type)
  
agent_run_events ──N:1── im_push_logs (可选关联，非 FK)
```

### 4.3 Migration 计划

Phase 1 迁移（4 张表）：
- `mYYYYMMDD_000001_im_channel_configs.up.sql`
- `mYYYYMMDD_000002_im_user_bindings.up.sql`
- `mYYYYMMDD_000003_im_thread_bindings.up.sql`
- `mYYYYMMDD_000004_im_push_logs.up.sql`

全部使用 `CREATE TABLE IF NOT EXISTS`，遵循 hub 现有 migration 命名惯例（`db/migration/`）。

---

## 5. 事件流架構

### 5.1 ASCII 数据流图

```
                        AgentHub Hub Server
 ┌──────────────────────────────────────────────────────────────────────┐
 │                                                                      │
 │  Edge callback                              ┌──────────────────┐    │
 │  POST /v1/edge/callback                     │ IMEventSubscriber│    │
 │        │                                     │                  │    │
 │        ▼                                     │ filter(event):   │    │
 │  agent_run_events 表 ◄── 写入 ──┐           │  fail-closed     │    │
 │        │                        │           │  type router     │    │
 │        │ 同时触发                │           │  debounce(5s)    │    │
 │        ▼                        │           │  content build   │    │
 │  ┌─────────────────┐            │           └────────┬─────────┘    │
 │  │ WS PushToUser   │────────────┤                    │              │
 │  │ NotificationSvc │            │                    ▼              │
 │  └─────────────────┘            │           ┌──────────────────┐    │
 │        │                        │           │ FeishuBackend    │    │
 │        ▼                        │           │                  │    │
 │  Web/Desktop/Mobile             │           │ sendCard()       │    │
 │  客户端（不受影响）              │           │ updateCard()     │    │
 │                                  │           │ token refresh    │    │
 │  ┌──────────────────────────────┘           │ WS 长连          │    │
 │  │                                          └────────┬─────────┘    │
 │  │ 审批决定回写                                       │              │
 │  │ POST /api/v1/tasks/{id}/approvals/{id}/decide      │              │
 │  │ （web/mobile/IM 共用同一端点）                      │              │
 │  │                                          ┌────────▼─────────┐    │
 │  └──────────────────────────────────────────► agent_run_events │    │
 │                                             │ (permission_     │    │
 │                                             │  decided event)  │    │
 │                                             └────────┬─────────┘    │
 │                                                      │              │
 │  ┌───────────────────────────────────────────────────┘              │
 │  │ 事件广播（WS + IMEventSubscriber 双路）                           │
 │  │ → Web/Desktop/Mobile 更新审批卡状态                               │
 │  │ → IMEventSubscriber.Filter → 更新飞书卡片（已处理）              │
 └──┼──────────────────────────────────────────────────────────────────┘
    │
    │ 飞书 API（外网）
    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  飞书开放平台                                                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐            │
│  │ 消息推送 API │  │ 卡片更新 API │  │ 事件回调 Webhook │            │
│  │ POST message │  │ PATCH message│  │ POST /callback   │            │
│  └─────────────┘  └──────────────┘  └────────┬─────────┘            │
│                                               │                      │
│                                               ▼                      │
│                                    ┌──────────────────────┐         │
│                                    │ 飞书客户端（用户手机）│         │
│                                    │ 审批卡按钮 → 回调    │         │
│                                    └──────────────────────┘         │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 审批全生命周期（IM 路径）

```
用户 A（飞书）                         hub-server                      用户 B（Desktop）
     │                                     │                                │
     │                                     │ ◄── Edge: permission_requested │
     │                                     │ IMEventSubscriber.Filter       │
     │                                     │ debounce: 豁免                  │
     │  ◄── 飞书审批卡推送 ────────────── │                                │
     │  [允许一次] [拒绝]                  │                                │
     │        │                            │                                │
     │        │ 点击「允许一次」             │                                │
     │        │ POST /callback              │                                │
     │        │ 签名校验 ✓                  │                                │
     │        │ open_id → user_id ✓         │                                │
     │        │ restrictDecision(allow)     │                                │
     │        │ DecideTaskApproval() ──────►│                                │
     │        │                            │ agent_run_events               │
     │        │                            │ (permission_decided)            │
     │        │                            │                                │
     │        │                            │ WS PushToUser ───────────────►│
     │        │                            │      │ 审批卡自动消解            │
     │  ◄── 飞书卡片更新「已允许」─────────│      │                          │
     │        │                            │                                │
     │        │  写 audit_log              │                                │
     │        │  {"action":"approval.im_decide","decision":"allow",...}     │
```

---

## 6. 飞书后端设计

### 6.1 模块结构

```
hub-server/internal/im/
├── mod.go                    # 接口定义 + 注册表
├── feishu/
│   ├── backend.go            # FeishuBackend 实现
│   ├── ws_client.go          # WebSocket 长连接客户端
│   ├── token_cache.go        # tenant_access_token 缓存（DB + 内存双读）
│   ├── card_builder.go       # 飞书卡片 JSON 构建器（纯函数，可单测）
│   ├── card_sanitize.go      # 敏感信息脱敏（路径截断、密钥过滤）
│   ├── signature.go          # 飞书事件签名校验
│   ├── callback_handler.go   # 飞书回调 HTTP handler
│   ├── reconnect.go          # 指数退避重连
│   └── *_test.go
├── subscriber/
│   ├── event_filter.go       # IMEventSubscriber: fail-closed 过滤
│   ├── debounce.go           # per-user debounce (5s)
│   └── *_test.go
├── command/
│   ├── dispatcher.go         # /approve /deny /bind 命令解析（MVP 只做 /bind）
│   └── *_test.go
├── binding/
│   ├── binding.go            # open_id ↔ user 绑定流程
│   └── *_test.go
└── crypto/
    ├── encrypt.go            # AES-256-GCM 加解密
    └── *_test.go
```

### 6.2 Go 接口设计（Phase 3 多渠道抽象预留）

```go
// im/mod.go

type ChannelBackend interface {
    // ChannelType returns the channel type identifier ("feishu", "telegram", ...).
    ChannelType() string

    // SendCard sends an interactive card message to a user.
    SendCard(ctx context.Context, userID string, card *CardPayload) (*SendResult, error)

    // UpdateCard updates an existing card message (e.g., mark as resolved).
    UpdateCard(ctx context.Context, userID, messageID string, card *CardPayload) error

    // VerifySignature validates the incoming webhook request authenticity.
    VerifySignature(body []byte, headers map[string]string) error

    // Start begins the backend's long-lived connection (e.g., WS for Feishu).
    Start(ctx context.Context) error

    // Stop gracefully shuts down the backend.
    Stop(ctx context.Context) error

    // Health returns nil if the backend is connected and operational.
    Health(ctx context.Context) error
}

type CardPayload struct {
    Header      CardHeader
    Elements    []CardElement
    Note        string // optional footer
}

type SendResult struct {
    MessageID string
    ChatID    string
}

// Optional: trait for backends that support command dispatching
type CommandDispatcher interface {
    Dispatch(ctx context.Context, userID string, command string, args []string) (*CommandResult, error)
}
```

### 6.3 FeishuBackend 关键实现细节

**tenant_access_token 缓存**：
```
获取优先级：
1. 内存 map（30min TTL，进程内读写锁）
2. DB im_channel_configs.token_expires_at（内存 miss 时读 DB，解密）
3. 飞书 API 获取（DB 和内存均 miss/过期）→ 写入 DB（加密）+ 内存

刷新策略：
- 在过期前 5min 主动刷新（后台 goroutine，每 5min tick）
- API 调用返回 token 过期错误时被动刷新
```

**飞书 WS 长连接**：
- 使用飞书开放平台的 WebSocket 长连接（`wss://open.feishu.cn/ws`）接收事件
- 连接建立后发送 `{"type": "establish", "token": "<access_token>"}`
- 心跳：每 30s 发送 ping，60s 无 pong 视为断开
- 断线重连：指数退避 1s/2s/4s/8s/16s/32s（封顶 60s），最多重试 10 次后告警
- **分片重组**：飞书事件可能分片（`_fragment_index` / `_fragment_total`），重组 buffer 60s TTL（抄 Codeg）

**卡片构建**（纯函数，可单测）：
```go
// card_builder.go
func BuildApprovalCard(approval *model.AgentTaskApproval) *CardPayload {
    return &CardPayload{
        Header: CardHeader{
            Title:    "Agent Approval Request",
            Template: "blue",
        },
        Elements: []CardElement{
            textElement(fmt.Sprintf("Tool: %s", approval.ToolName)),
            textElement(fmt.Sprintf("Path: %s", sanitizePath(payload.Path))),
            textElement(fmt.Sprintf("Preview: %s", sanitizeContent(payload.Content, 120))),
            hrElement(),
            actionElement([]CardAction{
                {Text: "Allow Once", Type: "primary",  Value: actionJSON("allow", approval.ApprovalID)},
                {Text: "Deny",      Type: "danger",   Value: actionJSON("deny",  approval.ApprovalID)},
            }),
        },
        Note: "From AgentHub. Allow once only; permanent approval must be done in-app.",
    }
}
```

**强制 `plain_text`**：所有 `tag` 使用 `plain_text`，禁止 `lark_md`（防 Markdown 注入，抄 Codeg）。

---

## 7. 渠道内交互面（MVP）

### 7.1 MVP 范围

| 功能 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| 飞书审批卡推送（allow_once/deny 按钮） | | **做** | |
| 飞书 run 完成/失败状态通知 | **做** | | |
| 飞书卡片按钮回调（审批决定） | | **做** | |
| 飞书 `/bind` 命令（账号绑定） | | **做** | |
| 飞书 `/approve` `/deny` 文字命令 | | 留接口 | |
| 飞书 `/task` 派单 | 不做 | 不做 | 不做（#1406） |
| Telegram 多渠道 | 不做 | 不做 | **做** |
| `ChannelBackend` trait 抽象 | 预留接口 | | **做** |

### 7.2 用户交互流程（MVP）

**绑定流程**：
```
用户在 AgentHub 设置页
  → 「IM 通知」→「绑定飞书」
  → 显示绑定说明 + 粘贴 bot webhook URL + app_id + app_secret
  → hub 保存 im_channel_configs + 生成绑定 token
  → 用户在飞书搜索 bot 发 /bind <token>
  → 绑定完成，im_user_bindings 写入
```

**审批流程**（Phase 2）：
```
hub 收到 permission_requested
  → IMEventSubscriber 过滤通过
  → 构建审批卡
  → 飞书 API 推送给用户
  → 用户点击「允许一次」/「拒绝」
  → 飞书回调 hub → 验证 → 审批决定写入
  → 飞书卡片更新为「已处理」
```

### 7.3 与 #1406 的边界约定

- 本提案产出 `hub-server/internal/im/command/dispatcher.go`（命令解析框架）
- 本提案产出 `im/mod.go` 的 `CommandDispatcher` 接口
- #1406 的派单命令（`/task` `/run` 等）注册到同一 dispatcher
- 本提案 **不实现** `/task` `/run` 的 handler，只留注册入口

---

## 8. 与 Mobile 的功能矩阵

（已在 §Q7 详述，此处为精简矩阵）

```
                     IM Bridge    Mobile App    Web/Desktop
审批通知             主动推送      推送           WS 实时
allow_once/deny      飞书卡片     完整审批页     完整审批页
allow_always         不支持        支持          支持
diff 预览            不支持        支持          支持
run 状态通知         推送          推送           WS 实时
流式内容             不支持        支持          支持
agent 配置管理        不支持        不支持        支持

互补关系：IM = 降级触达（无 app 时），Mobile = 完整体验
不打架：IM 决策 → hub 写事件 → WS 推送两端同步消解审批卡
```

---

## 9. 失败语义与降级

（已在 §Q8 详述，此处为策略摘要）

| 场景 | 策略 |
|---|---|
| 飞书 API 不可用 | 不重试，不阻塞 web/mobile 审批；记录 metrics + 日志 |
| 飞书 WS 断连 | 指数退避重连（1s→32s 封顶），重连后刷新 token |
| 飞书卡片回调失败 | 审批决定已在 hub 生效（真相侧完成），卡片 UI 不一致但安全 |
| 飞书事件签名校验失败 | HTTP 401，audit_log 记录 |
| 飞书 open_id 未绑定用户 | 回调返回错误消息「请先绑定账号」 |
| hub 重启 | token 从 DB 解密恢复，WS 重连，不重放断开期间事件 |
| DB 中 token 解密失败 | 标记 channel 为 error，alert，等待管理员重新配置 |

---

## 10. 分阶段 PR 计划

### Phase 1：数据模型 + 飞书后端 + 状态推送（无交互）

| ID | 变更 | 量级 | 验收 |
|---|---|---|---|
| 1.1 | Migration：4 张表（`im_channel_configs` 等） | S | migration up/down 测试 |
| 1.2 | `im/crypto/`：AES-256-GCM 加解密 + 单测 | S | `TestEncryptDecrypt_Roundtrip` |
| 1.3 | `im/feishu/token_cache.go`：tenant_access_token 缓存 | M | `TestTokenCache_Refresh/Hit/Miss` |
| 1.4 | `im/feishu/backend.go`：FeishuBackend 骨架 + 消息发送 | M | `TestSendCard_Integration`（fixture） |
| 1.5 | `im/subscriber/`：IMEventSubscriber + filter + debounce | M | `TestEventFilter_AllowList` + `TestDebounce_Window` |
| 1.6 | hub 主流程接入：在 agent callback/run 生命周期中挂接 subscriber | S | 集成测试：`TestIME subscriber_ReceivesPermissionRequested` |
| 1.7 | `im/feishu/card_builder.go`：状态通知卡构建 | S | `TestBuildStatusCard_Finished/Failed` |
| 1.8 | `im/feishu/card_sanitize.go`：敏感信息脱敏 | S | `TestSanitize_Path/ApiKey/UserPrompt` |
| 1.9 | `im/feishu/ws_client.go`：飞书 WS 长连接 | M | `TestWSClient_Connect/Reconnect`（fixture） |
| 1.10 | API：`POST /api/v1/im/channels`（CRUD）+ 绑定端点 | M | OpenAPI spec + handler tests |
| 1.11 | metrics + 日志 + 审计 | S | `TestAuditLog_IMDecision` |

**Phase 1 总工作量**：M-L（~2 周单人）

**Phase 1 验收证据**：
- 所有 Go 单测通过（`go test ./internal/im/... -count=1`）
- fixture 测试：使用 mock 飞书 API 验证完整推送链路
- 真实飞书 bot 发出一条测试通知（`real_tested=false` 标记为 fixture 阶段，approved-real 需要真实飞书群截图）
- `verify-doc-ssot.ps1` 通过
- migration up + down 在测试 PG 上验证

### Phase 2：审批卡回调 + 账号绑定

| ID | 变更 | 量级 | 验收 |
|---|---|---|---|
| 2.1 | `im/feishu/signature.go`：飞书事件签名校验 | S | `TestSignatureVerify_Valid/Invalid/Tampered` |
| 2.2 | `im/binding/`：open_id ↔ user 绑定流程 + `/bind` 命令 | M | `TestBindingFlow_Complete/TokenExpired` |
| 2.3 | `im/feishu/card_builder.go`：审批卡构建 | S | `TestBuildApprovalCard_AllowOnce/Deny` |
| 2.4 | `im/feishu/callback_handler.go`：飞书卡片回调处理 | M | `TestCallback_ApprovalAllow/Deny/Unbound/Replay` |
| 2.5 | hub 审批链集成：IM 决策 → `DecideTaskApproval` | S | 集成测试：IM 决策正确写入 agent_run_events |
| 2.6 | 审批卡状态同步：IM 决策后更新卡片 + WS 广播 | S | 集成测试：web/mobile/IM 三端卡同时消解 |
| 2.7 | `im/command/`：命令解析框架 + `/approve` `/deny` 文本命令（可选） | S | `TestCommandParse_Approve/Deny` |
| 2.8 | 安全加固：restrictDecision、audit_log、anti-replay | M | `TestRestrictDecision_RejectAlways` |

**Phase 2 总工作量**：M（~1.5 周单人）

**Phase 2 验收证据**：
- 真实飞书 bot + 真实 AgentHub 实例 + 飞书群：审批卡推送 → 按钮点击 → 审批生效 → 卡片更新（approved-real 证据：飞书群截图）
- Phase 1 所有 fixture 测试仍然通过

### Phase 3：多渠道抽象 + Telegram/企业微信预留

| ID | 变更 | 量级 | 验收 |
|---|---|---|---|
| 3.1 | `im/mod.go`：`ChannelBackend` trait 化（将 FeishuBackend 重构为实现） | M | `TestChannelBackend_Contract`（接口合同测试） |
| 3.2 | 注册表：`ChannelRegistry`，按 `channel_type` 路由 | S | `TestRegistry_Resolve/Duplicate` |
| 3.3 | Telegram 后端（可选） | L | 独立 SPEC |
| 3.4 | 企业微信后端（可选） | L | 独立 SPEC |

**Phase 3 总工作量**：M（重构 1 周）+ L（每新渠道 2-3 周）

### PR 分解总表

| Phase | PR 数（估） | 量级 | 风险 |
|---|---|---|---|
| Phase 1 | ~11 | M-L | 低（纯推送，无交互） |
| Phase 2 | ~8 | M | 中（回调安全 + 审批链集成） |
| Phase 3 | ~4 | M-L | 中（重构抽象） |

---

## 11. 风险评估

### 最大风险：飞书 open_id ↔ AgentHub user 绑定流程的用户体验

**风险描述**：绑定流程要求用户先在 AgentHub 设置页配置飞书 app/bot，再去飞书发 `/bind <token>`。这是两条不同的操作路径，用户可能在「粘贴 token」步骤流失。

**缓解措施**：
1. 设置页展示醒目的 step-by-step 引导（含截图）
2. 绑定 token 使用短码（6 位数字）替代 UUID（需单测验证碰撞风险）
3. 未来可选：飞书 OAuth 授权流程（用户飞书客户端一键授权，不需要手动复制 token）——但 MVP 不做

### 次要风险

| # | 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | 飞书 API 限流（消息发送频率过高） | 中 | 部分推送丢失 | debounce 5s 已降低频次；飞书机器人消息限额 5 条/秒/用户，单用户 debounce 后远低于此 |
| R2 | 飞书 WS 长连稳定性 | 中 | 事件接收延迟 | 指数退避重连 + heartbeat + 监控告警 |
| R3 | tenant_access_token 泄露 | 低 | 飞书 bot 被冒用 | 加密存储 + 审计日志 + 定期轮换（飞书 token 2h 自动过期） |
| R4 | 卡片按钮被非绑定用户点击 | 低 | 越权审批 | open_id → user_id 绑定校验 + 审批时验证用户确实拥有审批权限 |
| R5 | 飞书卡片 JSON 注入 | 低 | 展示异常/钓鱼 | 强制 plain_text + 敏感信息脱敏 + 输入长度帽 |
| R6 | Phase 3 抽象层过度设计 | 中 | 维护成本 | trait 只暴露 Phase 1-2 已验证的方法，不在 Phase 1 预设计 6 个方法 |

### 安全红线（不可绕过）

- [ ] 飞书事件签名校验：必须验证，不可跳过
- [ ] IM 侧审批限 allow/deny：代码级强制 `restrictDecision`
- [ ] 敏感信息不入卡：`card_sanitize.go` 必须有单测覆盖 `API_KEY`/`AUTHORIZATION`/`TOKEN` 关键词
- [ ] 审计日志：每笔 IM 侧审批决策必须写 `audit_logs`
- [ ] 飞书 app_secret 不入 git：迁移脚本不含真实密钥，示例值使用占位符 `FEISHU_APP_SECRET_PLACEHOLDER`

---

## 附录 A：Codeg ChatChannel 参考参数速查

| 参数 | Codeg 值 | AgentHub 采纳 |
|---|---|---|
| 事件过滤模式 | fail-closed, DEFAULT_OFF | 照搬 |
| debounce 窗口 | 5s | 照搬 |
| permission_request 豁免 debounce | 是 | 照搬 |
| 内容推送 ≥N 字符 | ≥500 字符（ContentDelta） | N/A（不做流式推送） |
| 飞书卡片 plain_text 强制 | 是 | 照搬 |
| WS 重连退避 | 指数退避 | 照搬 |
| 分片重组 TTL | 60s | 照搬 |
| tenant_access_token 缓存 | 内存 | DB 加密 + 内存双读 |
| session_bridge | 内存 map | DB im_thread_bindings |
| thread_binding 四元组 | topic↔(agent, model, session_id, working_dir) | 简化为 chat_id↔conversation_id/thread_id |
| per-sender auto_approve | 是 | **不做**（IM 限 allow_once/deny） |
| `/approve always` 命令 | 支持 | **不做**（安全边界） |
| 全局推送独立于会话级 | 双层订阅 | MVP 只做全局推送层 |

## 附录 B：飞书 API 参考

- 消息推送：`POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id`
- 消息更新（卡片）：`PATCH https://open.feishu.cn/open-apis/im/v1/messages/{message_id}`
- WebSocket 长连接：`wss://open.feishu.cn/ws`
- 事件订阅 URL 验证：`POST /callback → {challenge}` → 返回 `{challenge}` 完成验证
- tenant_access_token：`POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`
- 签名算法：SHA-256(timestamp + nonce + encrypt_key) vs `X-Lark-Signature`

## 附录 C：GitHub Issue 引用

- 实施追踪：#1407（本文档）
- @提及派单（独立立项）：#1406
- 本提案产出的 command dispatcher 可被 #1406 引用

---

*本文档不含真实密钥。所有示例值均为占位符（`FEISHU_APP_SECRET_PLACEHOLDER`、`ou_xxx`、`om_xxx`）。*
