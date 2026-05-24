# AgentHub 架构设计

> 本文是 AgentHub 项目的架构定稿,目标读者是项目开发者(人和 AI agent)。读完本文应能清楚地知道:这是一个什么项目、要实现哪些功能、由哪些模块组成、模块之间如何协作、关键决策的取舍是什么。

---

## 1. 设计哲学

四条贯穿全篇的原则,后面所有设计都从这几条推导。

**IM 是核心交互范式。** 用户、agent 都是平台上的"联系人",一切操作都是发消息回消息——私聊、群聊、@、撤回、引用,跟微信一模一样。区别只在于:有些联系人是真人,有些联系人是 AI。用户不需要学习新的交互模型。

**hub 是唯一权威真相源。** 多端(web + 桌面端)同账号实时同步,靠 hub 给每条消息分配全局单调递增的 `seq_id` 来保证顺序。其他模块(edge、web)的本地数据都是 hub 的副本/缓存,不持有"独占数据"。这是多端一致性的根基。

**控制流和数据流分离。** 文本类内容(消息、unified diff、URL、状态卡片、agent 总结)走 hub,跨端可见。代码源文件、构建产物、二进制大文件留在用户本地机器,不上传 hub。这样既保证多端协同,又避免把用户代码打到云端带来的隐私和成本问题。

**Agent 单设备绑定 + 轻模式触发。** 每个 agent 实例的 runner 跑在邀请人的桌面端 edge 上,邀请人离线则该 agent 离线。agent 平时不消耗算力,只在被 @ 时把"滑动窗口最近 N 条 + pin 消息"打包喂给 runner 一次,处理完就闲置。

---

## 2. 系统总览

### 2.1 模块拓扑

```
┌─────────┐                ┌──────────────┐
│   web   │ ─── WS ──────► │  server-hub  │
│(浏览器) │                │  (中心服务)  │
└─────────┘                └──────┬───────┘
                                  ▲
                                  │ WS (长连接,跨网络)
                                  ▼
                           ┌──────────────┐         ┌─────────┐
                           │ server-edge  │ ◄─────► │   App   │
                           │ (本地daemon) │ HTTP+WS │(桌面壳) │
                           └──────┬───────┘ (本地)  └─────────┘
                                  │ HTTP+WS (本地)
                                  ▼
                           ┌──────────────┐
                           │    runner    │
                           │ (CLI wrapper)│
                           └──────┬───────┘
                                  │ stdio
                                  ▼
                        Claude Code / Codex / ...
```

**直连 hub 的只有 web 和 edge。App 只跟本机 edge 通信,不直连 hub**——所有跨网络通信都走 edge 中转,App 是纯 UI 层。

### 2.2 模块职责一句话

| 模块 | 职责 |
| --- | --- |
| **web** | 浏览器端 IM UI,直连 hub,完整聊天体验,但不能预览本地产物 |
| **App** | 桌面壳,只与本机 edge 通信,提供本地能力(工作目录、文件预览、网页 iframe) |
| **server-edge** | 本地常驻 daemon,管 runner 生命周期、本地缓存、与 hub 同步 |
| **server-hub** | 中心服务器,数据权威源,消息路由,设备路由表,跨端推送 |
| **runner** | edge 的子进程,用 stdio 操作 agent CLI,把 CLI 能力封装成统一接口 |

### 2.3 通信协议总表

| 链路 | 协议 | 说明 |
| --- | --- | --- |
| web ↔ hub | HTTP + WebSocket | 跨网络,WS 长连推送,HTTP 请求响应 |
| App ↔ edge | HTTP + WebSocket | 本地 loopback,与 web↔hub 协议形态完全一致 |
| edge ↔ hub | HTTP + WebSocket | 跨网络,WS 双向推送,HTTP 注册和批量请求 |
| edge ↔ runner | HTTP + WebSocket | 本地 loopback,WS 用于流式接收 agent 输出 |
| runner ↔ CLI | stdio | runner 内部封装,CLI 差异在 runner 内消化 |

**所有跨模块通信统一使用 HTTP + WebSocket**。stdio 只发生在 runner 内部。

---

## 3. 模块详细设计

### 3.1 web

**定位**:浏览器端 IM 主力 UI,使用 React 实现。

**核心职责**:
- 与 hub 建立 WebSocket 长连接,接收消息推送
- 完整的 IM 体验:联系人列表、会话列表、聊天界面、群管理、消息撤回、@、引用
- 发起 agent 任务:用户在 web 输入"@Claude Code 帮我...",请求经 hub 转发到该用户在线的 edge 执行(edge 再驱动 runner 与 App)
- 流式接收并展示 agent 输出(打字机效果)
- 渲染消息中的 unified diff 文本、链接卡片、构建状态卡片

**能力限制**:
- 不能预览本地文件、本地网页(因为产物在用户的桌面端机器上,浏览器无权限访问)
- 不能"一键应用 diff"(同上)
- 适合"在公司电脑/任意浏览器看消息+发简单指令"的场景

### 3.2 App

**定位**:桌面壳(Electron / Tauri),提供本地能力增强的 IM 体验。

**核心职责**:
- UI 层与 web 共享同一套 React 组件,只是壳和数据源不同
- 不直连 hub,只跟本机 edge 通信(`http://localhost:xxx` + 本地 WS)
- 提供本地能力:
  - 工作目录选择 UI(给会话绑定本地项目路径)
  - 文件预览(代码文件、图片、文档)
  - 网页 iframe 预览(agent 部署的本地服务)
  - 系统通知、托盘、文件拖拽上传
  - 一键应用 diff(直接写到本地工作目录)
- App 启动时自动拉起 edge daemon

**单设备登录约束**:同账号同时只能在一台机器登录 App,后登录踢前。web 与 App 互不冲突,可以同时登录。

### 3.3 server-edge

**定位**:本地后台 daemon,App 的"本地后端",同时是 runner 的管理者。

**核心职责**:
- 与 hub 维持 WebSocket 长连接,接收推送、上传消息
- 管理 runner 子进程:启停、健康检查、生命周期
- 本地 SQLite 缓存:消息、会话、pending 队列(离线写入)、workspace 映射
- 处理 App 的写消息请求:本地落盘 → 推 hub → 等 hub 分配 `seq_id` → 标记 committed
- 处理 hub 推送:落盘 → 转给 App 更新 UI
- 向 hub 注册"我是 user X 的桌面端,在线",hub 据此把 web→agent 的任务路由过来
- workspace 任务串行调度:同一工作目录被多会话同时调用时,按 FIFO 排队

**为什么需要独立的 edge,不直接把这些塞进 App**:
- App 可能被用户关闭(关窗口),但 edge 作为后台 daemon 可以继续在线接收消息(系统托盘场景)
- runner 进程的生命周期管理与 App UI 解耦,UI 重启不影响正在跑的 agent 任务
- 本地数据(SQLite、pending 队列)归属边界清晰

### 3.4 server-hub

**定位**:中心服务器,所有数据的权威源,消息总线。

**核心职责**:
- **账号体系**:注册、登录、token 颁发与刷新、好友请求与确认
- **主数据库**:用户、会话、消息(全量)、群成员、agent 实例、设备表
- **设备路由表**:实时维护 `(user_id, device_type, conn_id, status)`,知道每个用户当前在哪些端在线
- **消息总线**:收到任何消息 → 分配全局单调递增 `seq_id` → 写库 → 广播给该会话所有在线设备
- **agent 任务路由**:web 发起的 agent 任务 → 查该用户在线的 edge → 转发执行指令
- **离线任务队列**:邀请人 App 离线时,web 发的 agent 任务进队列,App 上线后由 edge 拉取
- **推送通道**:对 web 和 edge 用统一的 WS 事件 envelope,按 device_type 过滤
- **增量同步**:客户端报 `last_synced_seq`,hub 推送之后的增量

### 3.5 runner

**定位**:edge 的子进程,真正与 agent CLI 交互的执行单元。

**核心职责**:
- 暴露 HTTP+WS 接口给 edge(本地 loopback)
- 内部通过 stdio 操作 agent CLI(Claude Code、Codex、OpenCode)
- 适配器层屏蔽不同 CLI 的差异,对外提供统一接口:
  - 输入:workspace 路径 + 系统 prompt(含身份注入) + 上下文消息数组 + 本轮指令
  - 输出:流式 tokens、工具调用记录、最终 diff/总结
- 失败上报给 edge,edge 再上报 hub
- runner 实例复用规则:同一用户在多个会话拉同一 agent → 共用一个 runner 进程,通过 `session_id` 参数区分上下文;不同用户拉同一 agent → 各自独立 runner

**runner 与 CLI 的关系**:runner 是 wrapper,把任意 CLI 的 stdio 操作封装成对 edge 的标准接口。CLI 差异(命令行参数、输入输出格式、能力)在 runner 内部消化,edge 不感知。

---

## 4. 核心功能设计

### 4.1 用户与认证

- **注册/登录**:用户名+密码或邮箱注册,登录返回 token
- **Token 策略**:短期 access_token(用于 API 调用)+ 长期 refresh_token(用于刷新),access 过期客户端自动用 refresh 续签;登出时双 token 作废
- **添加联系人**:按用户 ID 搜索 → 发送好友请求(可附验证消息)→ 对方在通知中看到 → 同意/拒绝/忽略 → 同意后双向加为联系人
- **agent 联系人**:平台预置的 agent(Claude Code、Codex 等)是公开资源,无需好友请求,直接可拉进会话
- **单设备约束**:web 和 App 各自只能在一台机器登录,后登录踢前。web 多标签页可共存。
- **踢前处理**:被踢端收到 WS 事件 `device.kicked`,UI 弹出提示"账号在另一台设备登录,你已被登出",清理本地 token 和缓存,跳回登录页
- **在线状态**:web 在线 OR App 在线 → 显示在线;两者都离线 → 离线
- **黑名单**:可拉黑联系人,被拉黑者无法发起新会话和发消息;已存在的群聊不受影响

### 4.2 会话与群聊

- **会话类型**:私聊(用户↔用户、用户↔agent)、群聊(成员可以是用户和 agent 的任意组合,不区分用户群/agent群/混合群)
- **群角色**:只有群主和成员两种
  - 群主:能踢人、能解散群、能转让群主、不能自行退群
  - 成员:能自行退群、不能踢人
- **建群**:任何用户可发起建群,创建者自动成为群主
- **拉人**:任何成员都可以拉用户或拉自己的 agent 进群
- **解散群**:群主可解散,广播解散事件,所有成员的会话变只读归档
- **转让群主**:群主可选定一个成员转让,转让后原群主变普通成员,可自行退群
- **邀请人退群联动**:成员退群时,他拉进来的 agent 跟着退,该 agent 所有未完成任务取消
- **会话操作**:置顶、归档、删除会话(仅本端隐藏,不影响他人)
- **群信息**:群名、群头像、群公告(群主可改)

### 4.3 消息

**消息类型**:
- 文本、代码块、unified diff 卡片、链接卡片(URL 预览)、文件附件、图片、@ 提醒、部署状态卡片

**消息操作**:
- 通用:回复、引用、转发、复制代码、pin(作为长期上下文)、撤回
- 仅 App:一键应用 diff、本地预览

**ID 策略**:
- 客户端发送时生成 `client_msg_id`(UUID),用于去重
- hub 接收后分配全局单调递增 `seq_id`,用于排序
- hub 若收到重复 `client_msg_id`,返回已存在的 `seq_id`,客户端不重复显示

**撤回规则**:
- 时限:发送后 2 分钟内可撤回
- 谁能撤:自己的消息任何人可撤(2 分钟内);群主可撤群里任何人的消息(无时限,管理员权限);agent 发的消息,邀请人可撤
- agent 上下文:撤回的消息从 runner 上下文窗口中去掉,被 pin 的消息撤回时同步 unpin
- 已被引用/回复的消息撤回后,引用处显示"该消息已撤回"

**pin 机制**:
- 任何成员可 pin 消息,被 pin 的消息出现在会话顶部固定栏(可折叠)
- pin 数量上限:每个会话最多 50 条
- pin 消息恒定参与 agent 上下文窗口
- 取消 pin:由 pin 的发起人或群主操作

**转发**:
- 可转发到任意联系人/群
- 转发消息保留原发送者标识(显示"转发自 X")
- 不可链式撤回(撤回原消息不影响转发副本)

**已读回执**:
- 私聊:显示"对方已读"或最近读到的消息位置
- 群聊:显示"已读 N 人",点击查看具体已读列表

**输入中提示**:
- 用户在输入框敲键时,客户端每 3 秒推一次 `typing` 事件给 hub
- hub 广播给该会话其他在线成员
- 接收方显示"对方正在输入...",5 秒未收到新 typing 事件自动隐藏
- agent 在 runner 工作时,也以同样机制显示"Claude Code 正在输入..."

**实时性**:WebSocket 长连推送、断线重连增量同步

### 4.4 Agent 行为

**触发模式(轻模式)**:agent 平时不工作,只在被 @ 时触发。触发时,edge 把"滑动窗口最近 N 条消息 + 用户 pin 的消息"打包成上下文,喂给 runner 处理一次。

**上下文窗口**:
- 滑动窗口大小按 token 预算动态计算(留充足空间给输出)
- pin 的消息恒定包含,不受窗口滑出影响
- 入群可见所有历史消息(包括入群前的)
- 退群后再被拉回,中间消息也可见
- 群里多个 agent 互相可见对方发言

**Agent 能力**:
- 能 @ 别人:可以 @ 用户(发提醒)、@ 其他 agent(Orchestrator 分派任务)
- 能主动发消息:仅限"自己被触发的任务结束时主动汇报",不能凭空插话
- 能读取绑定 workspace 的文件内容(当上下文需要)

**System Prompt 拼接**:
```
[平台固定身份段——不可被用户 prompt 覆盖]
你是 <agent_type>,是 <inviter_name> 在 AgentHub 平台拉进会话 <session_name> 的助手。
你的工作目录是 <workspace_path>。当前会话的成员包括:<member_list>。
不要假冒其他用户身份。

[用户自定义 System Prompt——全局覆盖]
<user_defined_prompt>

[运行时上下文]
<滑动窗口消息 + pin 消息>

[本轮指令]
<被 @ 的那条消息>
```

身份段始终前置且不可被覆盖,防止用户通过 prompt 注入假冒身份。

**Agent 实例复用**:
- 同一用户在多个会话拉同一 agent → 共用一个 runner 进程,每次 invoke 传 `session_id` 区分上下文
- 不同用户拉同一 agent → 各自独立 runner 进程
- 同一 workspace 被多个会话同时调用 → edge 本地按 FIFO 串行排队(防止文件写冲突)

### 4.5 多端协同

- hub 是唯一真相源,所有设备从 hub 读消息
- 同账号 web 和 App 实时同步聊天记录
- web 发起 agent 任务 → hub 路由到该用户在线的 edge 执行 → 输出经 hub 广播回所有端
- App 离线时,web 发的 agent 任务进 hub 队列等待,App 上线后 edge 拉取并执行
- 任务排队期间,web UI 显示"等待桌面端上线"或"排队中(前面 N 个任务)"
- 排队任务超时:24 小时未执行自动失败,通知发起人
- 同一用户 pending 任务上限:20 个,超过则拒绝并提示

### 4.6 产物处理

- agent 回复以 unified diff 文本嵌入消息(web 和 App 都能渲染显示)
- 链接、构建状态、部署 URL 以卡片形式展示
- **网页/文件预览仅 App 端可用**:edge 在本地起 HTTP server 或直接渲染本地文件,App iframe 嵌入
- **web 只能看 diff 文本和点链接**,无法预览本地产物
- 完整源码、构建产物、二进制文件留用户本地,不上传 hub

**文件附件上传流程**:
- 小文件(< 10 MB):客户端直接 POST 到 hub,hub 存对象存储,消息携带文件元数据(URL、文件名、大小、hash)
- 大文件:客户端先算 hash → 向 hub 申请上传凭证 → 客户端直传对象存储(不经 hub)→ 上传完成后 hub 收到回调,生成消息
- 同 hash 文件秒传:hub 检测到 hash 已存在,直接复用,不重复上传
- 附件展示:web 和 App 都能下载和查看,图片直接缩略图渲染

### 4.7 部署发布

- 用户在聊天中发"部署"指令,agent 返回部署状态卡片
- 一键生成预览 URL / 静态站点部署 / 容器化部署 / 源码打包下载
- 部署 URL 作为文本消息广播到所有端,任意端都能点开访问

### 4.8 通知系统

**通知类型**:
- @ 提醒(被 @ 时)
- 好友请求(收到好友申请时)
- 群邀请(被拉进群时)
- agent 任务完成(自己发的 agent 任务执行完毕)
- 系统公告(平台级通知)

**通知中心**:
- web:顶栏铃铛图标,点击展开通知列表,有未读红点
- App:系统托盘图标 + 通知中心面板

**推送渠道**:
- WS 实时推送(在线时)
- 浏览器 Notification API(web 后台/失焦时)
- 桌面端原生系统通知(App 关窗口但 edge 在线时)

**免打扰**:
- 每个会话可单独设置免打扰
- 免打扰会话:消息只在通知中心累加未读数,不弹系统通知,不响铃

### 4.9 搜索

**联系人搜索**:按用户 ID、昵称、备注名匹配,联系人列表顶部搜索框

**会话搜索**:按群名、最近一条消息内容、成员名匹配会话列表

**消息搜索**:
- 全局搜索:跨所有会话搜索消息内容
- 会话内搜索:在当前会话内搜索
- 过滤器:按发送者、时间范围、消息类型(文本/文件/图片/diff)过滤
- 搜索结果点击跳转到原会话定位到该消息

### 4.10 用户自建 Agent

**创建入口**:联系人页"创建自定义 Agent"按钮

**必填项**:
- agent 名称、头像
- 底层 agent_type(选 Claude Code / Codex / OpenCode 等支持的 CLI)
- System Prompt(全局覆盖,但平台身份段仍强制前置)

**可选项**:
- 能力标签(用于 Orchestrator 分派任务时识别)
- 默认工具集(允许调用的工具白名单)
- 模型参数(温度、max tokens 等)

**生命周期**:
- 创建后该 agent 出现在用户的联系人列表,可像预置 agent 一样拉进会话使用
- 配置存 hub,跟随用户账号,跨设备一致(任何设备登录都能看到自建的 agent)
- 编辑后立即生效,正在跑的任务用旧配置,新任务用新配置
- 删除自建 agent:已在使用中的会话会显示"该 agent 已被删除"并冻结,新会话不能再选

### 4.11 Orchestrator(主 Agent 协调器)

**定位**:平台预置的特殊 agent,在多 agent 群聊场景下做任务编排

**触发**:群聊里有多个 agent 时,任何成员 @ Orchestrator 发起复合任务

**核心职责**:
- 理解用户意图,把复杂任务拆成多个子任务
- 按子 agent 的能力标签分派任务,@ 对应 agent 触发执行
- 监听子 agent 输出流,完成后聚合结果,在群聊中汇总汇报

**协作能力**:
- **并行调度**:多个独立子任务可同时分派给不同 agent 跑
- **失败降级**:某子 agent 失败时,尝试切到能力相近的另一个 agent
- **代码冲突处理**:多 agent 改同一文件时,Orchestrator 协调合并(让其中一个先跑,把 diff 给另一个看)

**实现位置**:Orchestrator 本身也是一个 agent_type,有自己的 runner 适配器,prompt 里塞了任务编排的指令模板

---

## 5. 完整功能清单

按用户视角组织的功能 checklist,作为开发跟踪和验收依据。粒度细到可独立验证的最小功能。

### 5.1 账号与好友

- [ ] 注册(用户名+密码)
- [ ] 登录、登出
- [ ] access_token + refresh_token 自动刷新
- [ ] 修改头像、昵称
- [ ] 按用户 ID 搜索陌生人
- [ ] 发送好友请求(附验证消息)
- [ ] 处理好友请求(同意/拒绝/忽略)
- [ ] 联系人列表(用户+agent 混合展示)
- [ ] 删除联系人
- [ ] 拉黑/取消拉黑
- [ ] 设置联系人备注

### 5.2 会话管理

- [ ] 创建私聊(用户↔用户、用户↔agent)
- [ ] 创建群聊
- [ ] 会话列表(按最近活跃排序)
- [ ] 置顶会话
- [ ] 归档会话
- [ ] 删除会话(仅本端隐藏)
- [ ] 会话搜索(按群名/最近消息)

### 5.3 群聊管理

- [ ] 拉用户进群
- [ ] 拉自己的 agent 进群
- [ ] 成员自行退群
- [ ] 群主踢人
- [ ] 群主转让
- [ ] 群主解散群
- [ ] 邀请人退群联动:其拉的 agent 跟着退
- [ ] 修改群名、群头像、群公告

### 5.4 消息收发

- [ ] 发送文本
- [ ] 发送代码块
- [ ] 发送图片
- [ ] 发送文件附件(小文件直传 hub / 大文件直传对象存储)
- [ ] 发送链接(自动生成卡片预览)
- [ ] @ 用户 / @ agent
- [ ] 引用回复
- [ ] 转发消息
- [ ] 撤回消息(自己 2 分钟内 / 群主无时限)
- [ ] pin / 取消 pin
- [ ] pin 列表展示与折叠
- [ ] 已读回执(私聊+群聊)
- [ ] 输入中提示
- [ ] 消息搜索(全局+会话内,带过滤器)
- [ ] 重新生成(对 agent 消息)
- [ ] 复制代码

### 5.5 Agent 交互

- [ ] @ agent 触发任务
- [ ] 流式接收 agent 输出(打字机效果)
- [ ] agent 主动发任务完成消息
- [ ] agent @ 用户/其他 agent
- [ ] 用户自建 agent(name + prompt + agent_type + 工具集)
- [ ] 编辑/删除自建 agent
- [ ] Orchestrator 多 agent 协作(拆任务+并行+聚合汇报)
- [ ] 取消正在执行的 agent 任务
- [ ] App 离线时 web agent 任务排队展示
- [ ] 排队任务上限(20)与超时(24h)处理

### 5.6 产物处理

- [ ] 渲染 unified diff 卡片(web 和 App)
- [ ] 一键应用 diff 到本地(仅 App)
- [ ] 链接卡片预览(标题/描述/封面)
- [ ] 网页 iframe 预览(仅 App)
- [ ] 文件预览:代码、图片、PDF(仅 App)
- [ ] 部署状态卡片
- [ ] 一键部署 / 打包下载

### 5.7 多端协同

- [ ] web 与 App 实时同步聊天记录
- [ ] 单设备登录踢前(web/App 各自约束)
- [ ] 在线状态合并(任一在线即在线)
- [ ] 断线重连 + 增量同步(基于 last_synced_seq)
- [ ] App 离线时 web 发起的 agent 任务进 hub 队列
- [ ] App 上线后 edge 自动拉取队列任务
- [ ] edge 离线写入 pending 队列,重连后批量上传

### 5.8 通知

- [ ] WS 实时推送(在线)
- [ ] 浏览器 Notification API(web 失焦)
- [ ] 系统原生通知(App 关窗口)
- [ ] 通知中心(web 铃铛 / App 托盘)
- [ ] 通知类型:@ / 好友请求 / 群邀请 / agent 完成 / 系统公告
- [ ] 会话级免打扰开关

### 5.9 工作目录与本地能力(仅 App)

- [ ] 选择工作目录绑定到会话
- [ ] 多会话共享同一目录(edge 本地 FIFO 串行调度)
- [ ] 文件拖拽上传到聊天框
- [ ] 系统托盘常驻
- [ ] App 启动时自动拉起 edge daemon
- [ ] App 关窗口后 edge 继续在线接收消息

---

## 6. 关键流程时序

### 6.1 用户发文本消息(App 端)

```
1. App 发送 → POST 到 edge
2. edge 写本地 SQLite(状态: pending),生成 client_msg_id
3. edge → hub: WS 推送消息体
4. hub 写主库,分配 seq_id,持久化
5. hub 广播给该会话所有在线设备(含发送者其他端)
6. edge 收到 ack,更新本地状态: pending → committed,落盘 seq_id
7. web/其他 edge 收到推送,各自更新 UI 和本地缓存
```

web 端发送同理,只是省掉 edge 一跳,直接 web → hub。

### 6.2 用户发 agent 任务(App 端)

```
1. App 发"@Claude Code 帮我写个 React 组件"
2. edge 走文本消息流程(流程 6.1),让所有端看到"用户说了什么"
3. edge 识别接收方含 agent → 启动/复用对应 runner
4. edge 准备上下文(滑动窗口+pin消息) → 调 runner HTTP 接口
5. runner 内部用 stdio 调 Claude Code CLI
6. runner 流式收 CLI 输出 → WS 推送给 edge
7. edge 每收到一段输出,既写本地,也 WS 推给 hub
8. hub 广播给所有端,实现打字机效果
9. runner 任务结束 → edge 标记完成 → hub 广播 final 消息(含完整 diff)
```

### 6.3 用户发 agent 任务(web 端,App 在线)

```
1. web 发"@Claude Code 帮我..."
2. web → hub: 文本消息(全员可见)
3. hub 识别接收方含 agent,查该 agent 实例的邀请人在线 edge
4. hub → edge: 派发执行指令(WS 事件,只发给该 edge)
5. edge 收到 → 启动/复用 runner → 执行
6. runner 输出流回 edge → edge 推 hub → hub 广播
7. web 收到 agent 输出推送,展示打字机效果
```

### 6.4 用户发 agent 任务(web 端,App 离线)

```
1. web 发"@Claude Code 帮我..." → 流程同 6.3 步骤 1-3
2. hub 查到该 edge 离线 → 任务进 hub 离线队列
3. web UI 显示"等待桌面端上线"
4. App 上线 → edge 重连 hub → hub 推送队列中的待执行任务
5. edge 按 FIFO 顺序拉取并执行
6. 后续流程同 6.3 步骤 5-7
```

### 6.5 agent 主动发消息(任务完成汇报)

```
1. runner 任务执行结束 → 输出 final 消息给 edge
2. edge 构造一条新消息(发送者: agent_instance,内容: 任务总结+diff)
3. edge → hub: WS 推送
4. hub 走标准消息流程: 分配 seq_id → 持久化 → 广播
5. 所有在线端收到,显示 agent 主动发的消息
```

注意:agent 只能在"自己被触发的任务结束时"主动发,不能凭空插话(防止滥用)。

### 6.6 Orchestrator 编排多 agent

```
1. 用户在群聊 @Orchestrator "做一个登录页"
2. Orchestrator runner 启动,读取群成员的 agent 能力标签
3. Orchestrator 拆任务:[设计 UI(给 Agent A)] + [写后端 API(给 Agent B)]
4. Orchestrator 在群里发消息:"@Agent A 请设计..." + "@Agent B 请实现..."
5. 这些 @ 触发 Agent A 和 Agent B 各自的 runner 启动并执行(并行)
6. A 和 B 的输出流到群聊,Orchestrator 监听
7. 全部完成后 Orchestrator 在群聊汇总:"已完成,UI 见..., API 见..."
```

### 6.7 断线重连与增量同步

```
1. 客户端断线后重连,带上 last_synced_seq
2. hub 查询该用户该会话 seq > last_synced_seq 的所有消息
3. hub 批量推送增量
4. 客户端按 seq 顺序写入本地,UI 更新
5. edge 还需上传断线期间的 pending 队列,hub 按到达顺序分配 seq
```

### 6.8 单设备登录踢前

```
1. 用户在设备 B 登录(已经在设备 A 登录了)
2. hub 校验 token → 找到该 user_id+device_type 已有连接 conn_A
3. hub → conn_A 推 WS 事件 device.kicked
4. 设备 A 收到 → UI 提示 + 清理本地 token + 跳登录页
5. hub 关闭 conn_A,接受 conn_B 注册
```

---

## 7. 数据模型概要

只列核心实体和关键字段,完整 DDL 见后续技术文档。

### User
- `user_id` 主键
- `username` `password_hash` `avatar` `nickname`
- `created_at`

### Friendship
- `user_id` `friend_id` `status`(pending/accepted/blocked)
- `remark`(备注名)
- `created_at`

### Device
- `device_id` 主键
- `user_id` `device_type`(web/desktop)
- `conn_id` `online`
- `last_active_at`

### Session(会话)
- `session_id` 主键
- `type`(private / group)
- `name`(群名,私聊为空)
- `owner_user_id`(群主,私聊为空)
- `announcement`(群公告)
- `created_at`

### SessionMember
- `session_id` `user_id`(或 `agent_instance_id`)
- `role`(owner / member)
- `muted`(免打扰)
- `joined_at`

### Message
- `message_id` 主键
- `session_id` `seq_id`(全局递增,排序权威)
- `client_msg_id`(去重)
- `sender_type`(user / agent_instance) `sender_id`
- `content_type`(text / code / diff / link_card / file / image / deploy_card)
- `content`(JSON,按 content_type 解析)
- `reply_to_message_id`(引用)
- `pinned` `recalled`
- `created_at`

### MessageRead(已读回执)
- `message_id` `user_id` `read_at`

### AgentInstance
- `agent_instance_id` 主键
- `agent_type`(claude-code / codex / opencode / orchestrator / custom)
- `session_id`(所属会话)
- `inviter_user_id`(邀请人,决定 runner 跑在哪台 edge)
- `system_prompt`(用户自定义)
- `workspace_path`(若已绑定)
- `created_at`

### CustomAgent(用户自建 agent 定义)
- `custom_agent_id` 主键
- `owner_user_id`
- `name` `avatar` `agent_type`(底层 CLI)
- `system_prompt` `capability_tags` `tool_whitelist` `model_params`
- `created_at`

### Workspace
- `workspace_id` 主键
- `device_id`(归属哪台 edge)
- `local_path`
- `bound_session_ids`(JSON 数组,可被多会话共享)

### PendingAgentTask
- `task_id` 主键
- `agent_instance_id` `triggered_by_user_id`
- `trigger_message_id`
- `status`(queued / dispatched / running / done / failed / timeout)
- `created_at` `expire_at`(默认 24 小时)

### Notification
- `notification_id` 主键
- `user_id` `type`(mention / friend_request / group_invite / agent_done / system)
- `payload`(JSON)
- `read` `created_at`

### Attachment
- `attachment_id` 主键
- `hash` `size` `mime_type` `storage_url`
- `uploader_user_id` `created_at`

---

## 8. 接口分层

接口按调用方角色分三组,共用部分放 `/client/*`,各端专属部分独立路径。

### 8.1 `/client/*`(web 和 edge 共用)

IM 基础能力,两端都需要:

- 认证:登录、登出、token 刷新
- 联系人:好友请求、同意、列表查询、拉黑、备注
- 会话:创建、列表、置顶、归档、群成员管理(拉人、踢人、退群、转让群主、解散群)
- 消息:发送、查询历史、增量同步、撤回、pin、引用、转发、已读回执、输入中提示
- 搜索:联系人/会话/消息搜索
- 通知:列表、标记已读、免打扰开关
- 实时:WebSocket 订阅消息推送、状态变更

### 8.2 `/web/*`(web 专属)

- 触发 agent 任务:web 发出 agent 调用请求,hub 内部转发到在线 edge
- 查询自己的桌面端在线状态
- 取消正在排队/执行的 agent 任务
- 自建 agent 管理(创建/编辑/删除)

### 8.3 `/edge/*`(edge 专属)

- 设备注册:edge 启动时上报 `device_id` `app_version` `capabilities`(支持哪些 agent)
- 接收 agent 任务派发:WS 事件,hub 推送给 edge
- 上报 runner 状态:任务进度、token 消耗、完成/失败
- 上报 agent 输出流:runner 流式产出 → edge 转发到 hub
- workspace 管理:绑定/解绑工作目录,同步给 hub(只存元数据)

### 8.4 WebSocket 事件 envelope

统一格式,便于扩展和过滤:

```json
{
  "type": "message.new" | "message.recall" | "agent.dispatch" | "agent.stream" | "device.online" | "device.kicked" | ...,
  "seq_id": 12345,
  "payload": { ... }
}
```

hub 推送时按 `device_type` 过滤事件:`agent.dispatch` 只发给 edge,web 永远收不到。

### 8.5 鉴权

token 中带 `device_type`,hub 在请求入口校验。web 调 `/edge/*`、edge 调 `/web/*` 直接 403。

---

## 9. 边界与未尽事项

明确这版架构的限制和暂不解决的问题,让读者知道权衡在哪。

### 9.1 已知限制

**跨设备工作不连续**:文件不上云,意味着公司机器跑的 agent 任务在家机器上接不上。会话绑定的 workspace 只在某一台 edge 上有效。这是为了保护用户代码隐私的主动取舍。

**单设备登录**:App 同账号同时只能一台机器登录,跨设备切换需要重新登录(后登录踢前)。web 不受此限制(多浏览器/多标签可共存)。

**轻模式 agent 不主动监控**:agent 只在被 @ 时工作,平时不读消息也不会主动介入。意味着不支持"agent 发现紧急情况主动插话"这类行为。如未来需要,可在轻模式之上叠加触发器机制。

**网页预览仅 App**:web 端没有访问本地文件系统的能力,无法预览 agent 生成的本地网页/文件。web 用户要预览必须切到 App。

**消息撤回边界**:超过 2 分钟无法撤回(群主例外),撤回后从 agent 上下文中移除——意味着 agent 可能已经基于撤回的内容做了工作,撤回不能"撤销 agent 的行为",只能让后续触发的 agent 看不到。

### 9.2 待后续技术文档细化

- 完整 API 列表与字段定义
- WebSocket 事件类型完整枚举
- runner 适配器接口规范(让用户能自己实现新 agent 的接入)
- 数据库完整 DDL 与索引设计
- 部署拓扑(hub 如何水平扩展,edge 如何打包分发)
- 安全细节(token 过期策略、重放防护、消息加密)
- 性能预算(消息推送延迟目标、agent 并发上限)

### 9.3 课题交付物对应关系

| 课题要求 | 对应内容 |
| --- | --- |
| 产品设计文档 | 待编写,基于本架构文档的功能章节扩展 |
| 技术文档 | 本文 + 后续接口/数据库详细文档 |
| 可运行 Demo | 五模块各自实现 + 集成 |
| AI 协作开发记录 | 开发过程中沉淀 spec/skill/rules |
| 3 分钟 Demo 视频 | 演示核心 IM 体验 + 多 agent 协作 |
