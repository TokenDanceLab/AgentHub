# AgentHub Session Sharing & Multi-User Collaboration

> 基于: design-data-portability.md (JSONL SSOT / ShareView / Fork 分享),
> design-protocol.md (ConversationAuthority + Hub-Edge sync + PermissionVisibility),
> cross-analysis-orchestration.md (@mention 群聊 + 消息树 + cycle detection),
> librechat.md (Multi-Tab Sync / Fork / Session 管理)
>
> 目标: 会话只读分享、多人协作编辑、Agent 产物团队可见性。

---

## 1. 权限模型

三级权限，逐级放宽：

| 级别 | 查看消息 | 查看 Artifact | 添加评论 | 发消息/@Agent | Fork | Agent 执行 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **viewer** | Yes | Yes (hub-cache) | No | No | No | No |
| **commenter** | Yes | Yes | Yes | No | No | No |
| **editor** | Yes | Yes | Yes | Yes | Yes | Yes (原 authority) |

Thread 级分享默认继承到子 Thread（可覆写为更严格）。Conversation 级分享覆盖所有 Thread。权限优先级：`Conversation 级 < Thread 级 < 用户显式 deny list`。

---

## 2. 只读分享（Share Link）

### 2.1 Token 生成

```
POST /api/conversations/:id/share
Body: { permission: "viewer", expires_in_days: 7, password?: string }
Response: { share_id, share_url, token, expires_at }
```

- Token: 256-bit CSPRNG, URL-safe base64, 不可猜测
- 默认 7 天过期（最长 90 天）。可选 bcrypt 密码保护
- 创建者随时可 revoke：`DELETE /api/shares/:id`

### 2.2 访问流

```
浏览器打开 /share/{token}
  ├─ token 过期 → "此分享已过期"
  ├─ 有密码 → 密码门 (bcrypt verify, 连续 5 次错误锁 15 分钟)
  └─ 通过 → 只读 Conversation View (消息树 + SiblingSwitch + Artifact 预览)
```

只读约束：无输入框、无 @mention、无 Fork 按钮、无 artifact 原始文件下载（除非 `allow_download`）。顶部栏显示 "只读分享 · {owner} · {expires_at} 过期"。
HTML 导出作为静态备选（参考 design-data-portability.md Sec 2.4），自包含 JSONL + 渲染引擎，双击即看。

---

## 3. 评论分享（commenter）

commenter 可在消息和 Artifact 上添加评论，评论不写入主 EventStore。

```go
type ShareComment struct {
    ID         string    `json:"id"`
    ShareID    string    `json:"shareId"`
    TargetID   string    `json:"targetId"`    // MessageID 或 filePath+lineNo
    TargetType string    `json:"targetType"`  // "message" | "diff_line" | "artifact"
    AuthorName string    `json:"authorName"`  // 自行输入（无需登录）
    Content    string    `json:"content"`
    Resolved   bool      `json:"resolved"`    // 仅 owner 可 resolve
    CreatedAt  time.Time `json:"createdAt"`
}
```

约束：评论存储在 `share_comments` 表，share revoke 时 cascade delete。评论者不可触发 Agent、不可创建 Thread、不可修改消息。

---

## 4. 协作编辑（editor）

editor 可发消息、@Agent、Fork。核心挑战：多用户消息同步 + Agent 执行归属。

### 4.1 Authority 在协作下的行为

参考 design-protocol.md 的 ConversationAuthority。**分享不迁移 Authority，只授权参与。**

| 原 Authority | 协作消息写入 | Agent 执行 | 消息广播 |
|-------------|-------------|-----------|---------|
| **edge** | 协作者消息 relay 到 owner Edge | Agent 在 owner Edge Runner 执行 | Hub broadcast 到所有在线协作者 |
| **hub** | 所有协作者直写 Hub EventStore | Hub 调度到可用 Edge | Hub broadcast |
| **hybrid** | Hub 为 SSOT, Edge 同步 | Hub 调度 | Hub broadcast + Edge seq-sync |

### 4.2 多用户消息同步

```
协作者 A 发送消息
  ├─ 写入 Authority 端 EventStore, 分配 monotonic seq
  ├─ Hub 广播 SyncBatch (message.created) 到所有在线协作者 B, C 的 Edge/Web
  └─ 含 @Agent 时:
       ├─ 调度层选择 Worker (参考 cross-analysis-orchestration.md Sec 2.4)
       ├─ Agent 在原 ExecutionAuthority 运行
       └─ Agent 响应走同一广播通道
```

### 4.3 冲突与约束

- **消息写入**：IM append-only 模型天然无写-写冲突
- **同时 Fork**：先到先得，两个分支均保留在消息树（SiblingSwitch 切换），不静默丢弃
- **Fork 分支数限制**：`MAX_FORK_BRANCHES_PER_MESSAGE = 5`（参考 cross-analysis-orchestration.md Layer 4）
- **Agent tool 执行**：沿用原 PolicyRule，不由分享放宽
- **加入门槛**：editor 必须为注册用户（需 Edge 身份接收 relay 事件），viewer/commenter 可匿名

---

## 5. Agent 产物团队可见性

Artifact 的 ArtifactAuthority 决定物理存储。协作场景下所有参与者通过 Hub 中转访问：

| ArtifactAuthority | 原始访问 | 共享后访问 |
|-------------------|---------|-----------|
| **edge** | 仅 owner Edge | Hub 拉取 + 缓存为 hub-cache，协作者从 Hub 读取 |
| **hub-cache** | Hub 直接可读 | 所有协作者直接读 Hub |
| **object-storage** | 签名 URL | Hub 生成短期 presigned URL 分发 |

**Hub 缓存策略**：share 创建时主动拉取 Artifact 元数据，内容按需懒加载（首次预览时触发）。缓存 TTL = share 有效期，revoke 时清理。大 Artifact (>16MB) 仅缓存元数据，内容从 object-storage presigned URL 直取。

**安全隔离**：per-share artifact URL (`/share/{token}/artifacts/{id}`)，每次访问双重校验 share token + artifact 归属 conversation。产物不跨 conversation 泄漏。

---

## 6. 数据模型与生命周期

```go
type ShareRecord struct {
    ID             string          `json:"id"`
    ConversationID ConversationID  `json:"conversationId"`
    ThreadID       *ThreadID       `json:"threadId,omitempty"`  // nil = 整个 conversation
    Token          string          `json:"token"`
    PasswordHash   string          `json:"passwordHash,omitempty"`
    Permission     SharePermission `json:"permission"`  // "viewer" | "commenter" | "editor"
    AllowDownload  bool            `json:"allowDownload"`
    CreatedBy      string          `json:"createdBy"`
    CreatedAt      time.Time       `json:"createdAt"`
    ExpiresAt      time.Time       `json:"expiresAt"`
    RevokedAt      *time.Time      `json:"revokedAt,omitempty"`
    ViewCount      int             `json:"viewCount"`
}
type SharePermission string
const (
    ShareViewer    SharePermission = "viewer"
    ShareCommenter SharePermission = "commenter"
    ShareEditor    SharePermission = "editor"
)
```

Share 记录存储在 Hub，不写入 Edge EventStore。`token` 建 unique index，`expires_at` 建 index 支持定时清理。

**生命周期**：
1. **创建**：`agenthub share create <conv-id> --permission editor --expires-in 7 --password x`
2. **加入** (editor)：协作者登录后打开 share URL → Hub 检测已注册用户 + Edge 连接 → 绑定为 editor → 广播 `collaborator.joined` → 开始同步
3. **续期**：`PUT /api/shares/:id/renew { expires_in_days: 7 }`
4. **吊销**：Token 立即失效，广播 `share.revoked`，cascade clean `share_comments`，协作者本地 EventStore 保留已同步消息
5. **过期**：定时任务扫描 `expires_at < now()`，处理同 revoke

---

## 7. 安全边界

| 威胁 | 防护 |
|------|------|
| Token 猜测 | 256-bit CSPRNG |
| Token 泄露 | 默认 7d 过期 + owner 随时 revoke |
| viewer 越权写 | UI 无输入框 + API 层二次校验 share permission |
| editor 越权 touch 危险 tool | Agent 沿用原 PolicyRule，不由分享放宽 |
| 密码爆破 | bcrypt cost=12; 5 次错误锁 15 分钟 |
| Artifact 跨 conversation 泄漏 | per-share URL + 双重归属校验 |

---

## 8. 分阶段实现

| 阶段 | 功能 | 依赖 |
|:---:|------|------|
| P0 | Share CRUD API + token 生成 + 过期/revoke 扫描 | Hub Server |
| P1 | 只读 share link + 密码门 + HTML 静态导出 | P0 + EventStore 读接口 |
| P1 | commenter + `share_comments` 表 | P0 |
| P2 | editor 协作 + fan-out 广播 + 多人消息同步 | P0 + Hub-Edge sync protocol |
| P2 | Artifact 懒加载缓存 + per-share proxy URL | P2 协作 |
| P3 | E2EE share (协作内容端到端加密) | P2 协作 + Hub Relay |

---

## 9. 关键设计决策

| 决策 | 选择 | 依据 |
|------|------|------|
| Authority 不因分享迁移 | 分享 = 授权参与，非移交所有权 | revoke 后无所有权黑洞 |
| 评论不写入主 EventStore | 独立 `share_comments` 表 | 不污染 SSOT，revoke cascade clean |
| editor 必须注册用户 | 匿名不可 editor | 需 Edge 身份接收 relay；可审计 |
| Artifact 按需懒加载 | 非主动全量同步 | 节省带宽，大文件直取 object-storage |
| Fork 冲突：先到先得+双方可见 | 不静默丢弃 | 消息树天然多分支，SiblingSwitch 对比 |
| 密码 bcrypt cost=12 | 非可配置 | 安全与延迟平衡；锁机制防爆破 |

---

*Design complete. 2026-05-21.*
