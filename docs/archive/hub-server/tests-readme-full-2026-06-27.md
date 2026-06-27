# Hub Server 集成测试指南

## 运行测试

```powershell
# 跳过集成测试（不需要数据库/Redis）
go test ./hub-server/tests/ -short -count=1

# 运行完整集成测试（需要 PostgreSQL + Redis）
go test ./hub-server/tests/ -count=1
```

`-short` 模式下 `TestMain` 会直接退出，不启动 DB/Redis。完整模式需要 `hub-server/configs/config.yaml` 中配置好数据库和 Redis 连接。

## 测试隔离

每个顶层测试函数通过 `t.Cleanup` 自动清理数据库：

```go
func TestAuth(t *testing.T) {
    t.Cleanup(func() { CleanDB(t, db) })
    // ... 测试逻辑
}
```

`CleanDB` 按外键依赖的逆序删除所有表的数据（子表先删，父表后删）。所有测试共享同一个 DB 实例，但每个测试结束后数据会被清空，保证隔离。

## 常用 Helper

### CleanDB — 清空所有表

```go
t.Cleanup(func() { CleanDB(t, db) })
```

### CreateTestUser — 注册并登录

```go
user, token := CreateTestUser(t, client, baseURL)
// user: *model.User (包含 ID、Username、Nickname 等字段)
// token: JWT access token
```

### CreateTestSession — 创建私聊会话

```go
session := CreateTestSession(t, client, baseURL, token, targetUserID)
// session: *model.Session
```

### AssertHTTPStatus — 检查 HTTP 状态码

```go
resp := get("/client/auth/me", token)
AssertHTTPStatus(t, resp, http.StatusOK)
```

### 底层 HTTP 辅助函数

测试包内可直接使用以下函数（无需 client/baseURL 参数，自动使用 TestMain 初始化的测试服务器）：

```go
// GET 请求
resp := get("/client/sessions", token)

// POST 请求
resp := post("/client/auth/register", body)

// POST 认证请求
resp := postAuth("/client/sessions/private", token, body)

// PUT 请求
resp := put("/client/auth/password", token, body)

// DELETE 请求
resp := del("/client/contacts/:id", token)

// 解析响应
r := parse(resp) // 返回 apiResp{Code, Message, Data}

// 断言
mustOK(t, r, "操作描述")
mustCode(t, r, "ERROR_CODE", "错误描述")
```

## 测试隔离规则

1. **每个顶层 Test 函数必须调用 `t.Cleanup`**：`t.Cleanup(func() { CleanDB(t, db) })`
2. **子测试 (t.Run) 之间共享数据**：同一 `TestXxx` 下的子测试共享同一组用户/数据，不需要单独清理
3. **用户名必须唯一**：使用前缀区分不同测试函数，避免跨测试重名冲突
4. **不要修改全局状态**：`ts`、`client`、`db`、`mgr`、`bus` 由 `TestMain` 统一管理
5. **Redis 状态**：`CleanDB` 只清理 PostgreSQL，Redis 缓存在 `TestMain` 启动时由 `cleanDBTables` 连带清除（缓存基于 DB 数据，清表后缓存自动失效）

## 添加新测试

1. 在 `*_test.go` 文件中创建新的 `TestXxx` 函数
2. 函数第一行添加 `t.Cleanup(func() { CleanDB(t, db) })`
3. 使用 `register(t, username, password, nickname)` 创建测试用户
4. 使用 `get`/`post`/`postAuth`/`put`/`del` 发送请求
5. 使用 `mustOK`/`mustCode` 断言响应
6. 需要验证字段值时使用 `parse(resp).Data` + `json.Unmarshal`
