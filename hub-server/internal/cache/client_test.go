package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testClient creates a Client backed by a fresh miniredis instance.
func testClient(t *testing.T) (*Client, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return NewClient(rdb), mr
}

// ==================== NewClient / GetRDB / PoolStats ====================

func TestNewClient(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	c := NewClient(rdb)
	assert.NotNil(t, c)
	assert.NotNil(t, c.GetRDB())
}

func TestGetRDB(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	c := NewClient(rdb)
	assert.Same(t, rdb, c.GetRDB())
}

func TestPoolStats(t *testing.T) {
	c, _ := testClient(t)
	stats := c.PoolStats()
	assert.NotNil(t, stats)
}

// ==================== GetOrLoad ====================

type loadCount struct {
	mu    sync.Mutex
	count int
}

func (l *loadCount) inc() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.count++
	return l.count
}

func TestGetOrLoad_CacheHit(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Pre-populate cache
	v := map[string]string{"foo": "bar"}
	b, err := json.Marshal(v)
	require.NoError(t, err)
	require.NoError(t, c.rdb.Set(ctx, "hit-key", b, 10*time.Second).Err())

	loaderCalls := 0
	got, err := GetOrLoad(c, ctx, "hit-key", 30*time.Second, func(ctx context.Context) (map[string]string, error) {
		loaderCalls++
		return map[string]string{"wrong": "value"}, nil
	})
	require.NoError(t, err)
	assert.Equal(t, "bar", got["foo"])
	assert.Equal(t, 0, loaderCalls, "loader should not be called on cache hit")
}

func TestGetOrLoad_CacheMiss(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	got, err := GetOrLoad(c, ctx, "miss-key", 30*time.Second, func(ctx context.Context) (map[string]string, error) {
		return map[string]string{"fresh": "data"}, nil
	})
	require.NoError(t, err)
	assert.Equal(t, "data", got["fresh"])

	// Verify cached
	b, err := c.rdb.Get(ctx, "miss-key").Bytes()
	require.NoError(t, err)
	var cached map[string]string
	require.NoError(t, json.Unmarshal(b, &cached))
	assert.Equal(t, "data", cached["fresh"])
}

func TestGetOrLoad_SingleflightDedup(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	lc := &loadCount{}
	var wg sync.WaitGroup
	results := make([]int, 10)

	// Windows flake 修复：原实现用 100ms loader sleep 作为 flight 窗口，
	// Windows runner 调度抖动可超过该窗口，迟到 goroutine 错过 flight 触发
	// 第二次加载。改为阻塞式 loader：释放时机由测试掌握，flight 窗口不再
	// 依赖墙钟——释放前所有 goroutine 必然并入同一 flight。
	release := make(chan struct{})
	var started atomic.Int64
	var arrived atomic.Int64

	// Phase 1: release all goroutines simultaneously.
	barrier := make(chan struct{})
	var start sync.WaitGroup
	start.Add(10)

	// Phase 2: all goroutines wait until everyone is at the GetOrLoad call.
	var ready sync.WaitGroup
	ready.Add(10)

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			start.Done()
			<-barrier

			ready.Done()
			ready.Wait() // all goroutines now calling GetOrLoad together
			arrived.Add(1)
			v, err := GetOrLoad(c, ctx, "sf-key", 30*time.Second, func(ctx context.Context) (int, error) {
				started.Add(1)
				<-release
				lc.inc()
				return 42, nil
			})
			require.NoError(t, err)
			results[idx] = v
		}(i)
	}
	start.Wait()
	close(barrier)

	// flight 启动后即被 release 阻塞，缓存必然为空；等全部 goroutine
	// 进入 GetOrLoad 后再释放，保证所有调用并入同一 flight。
	require.Eventually(t, func() bool { return started.Load() >= 1 },
		5*time.Second, 5*time.Millisecond, "singleflight loader should have started")
	require.Eventually(t, func() bool { return arrived.Load() == 10 },
		5*time.Second, 5*time.Millisecond, "all goroutines should have entered GetOrLoad")
	// settle 窗口：arrived 只保证进入 GetOrLoad，GET 本身可能还在飞；等一个
	// 有界窗口让所有 GET 在 flight 存活期间落地（miss→并入），再释放。
	settle := time.Now()
	require.Eventually(t, func() bool { return time.Since(settle) >= 200*time.Millisecond },
		2*time.Second, 10*time.Millisecond, "in-flight GETs should settle before release")
	close(release)

	wg.Wait()

	assert.Equal(t, 1, lc.count, "singleflight: loader should be called exactly once")
	for i, r := range results {
		assert.Equal(t, 42, r, "result[%d] should be 42", i)
	}
}

func TestGetOrLoad_LoaderError(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	_, err := GetOrLoad(c, ctx, "err-key", 30*time.Second, func(ctx context.Context) (string, error) {
		return "", assert.AnError
	})
	assert.Error(t, err)
}

func TestGetOrLoad_IntType(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	got, err := GetOrLoad(c, ctx, "int-key", 30*time.Second, func(ctx context.Context) (int, error) {
		return 99, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 99, got)
}

func TestGetOrLoad_StructType(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	type item struct {
		Name  string `json:"name"`
		Value int    `json:"value"`
	}
	got, err := GetOrLoad(c, ctx, "struct-key", 30*time.Second, func(ctx context.Context) (item, error) {
		return item{Name: "test", Value: 42}, nil
	})
	require.NoError(t, err)
	assert.Equal(t, "test", got.Name)
	assert.Equal(t, 42, got.Value)
}

func TestGetOrLoad_CacheHitRemovesStale(t *testing.T) {
	// If cached data is corrupted/malformed JSON, loader should be called.
	c, _ := testClient(t)
	ctx := context.Background()

	// Store invalid JSON
	require.NoError(t, c.rdb.Set(ctx, "stale-key", []byte("not-json"), 10*time.Second).Err())

	got, err := GetOrLoad(c, ctx, "stale-key", 30*time.Second, func(ctx context.Context) (string, error) {
		return "fresh-value", nil
	})
	require.NoError(t, err)
	assert.Equal(t, "fresh-value", got)
}

// ==================== Invalidate ====================

func TestInvalidate_RemovesKeys(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.rdb.Set(ctx, "k1", "v1", 0).Err())
	require.NoError(t, c.rdb.Set(ctx, "k2", "v2", 0).Err())
	require.NoError(t, c.rdb.Set(ctx, "k3", "v3", 0).Err())

	err := c.Invalidate(ctx, "k1", "k3")
	require.NoError(t, err)

	_, err1 := c.rdb.Get(ctx, "k1").Result()
	assert.ErrorIs(t, err1, redis.Nil)

	_, err2 := c.rdb.Get(ctx, "k2").Result()
	assert.NoError(t, err2)

	_, err3 := c.rdb.Get(ctx, "k3").Result()
	assert.ErrorIs(t, err3, redis.Nil)
}

func TestInvalidate_EmptyKeys(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()
	err := c.Invalidate(ctx)
	assert.NoError(t, err)
}

func TestInvalidate_NoOpOnMissingKey(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()
	err := c.Invalidate(ctx, "nonexistent")
	assert.NoError(t, err)
}

// ==================== Route CRUD ====================

func TestSetRoute_GetRoute_DeleteRoute(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Set
	err := c.SetRoute(ctx, "user-A", "desktop", "conn-1")
	require.NoError(t, err)

	// Get
	conn, err := c.GetRoute(ctx, "user-A", "desktop")
	require.NoError(t, err)
	assert.Equal(t, "conn-1", conn)

	// Get non-existent device
	_, err = c.GetRoute(ctx, "user-A", "mobile")
	assert.ErrorIs(t, err, redis.Nil)

	// Get non-existent user
	_, err = c.GetRoute(ctx, "user-B", "desktop")
	assert.ErrorIs(t, err, redis.Nil)

	// Delete
	err = c.DeleteRoute(ctx, "user-A", "desktop")
	require.NoError(t, err)

	// Verify deleted
	_, err = c.GetRoute(ctx, "user-A", "desktop")
	assert.ErrorIs(t, err, redis.Nil)
}

func TestRouteCRUD_TableDriven(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	tests := []struct {
		name     string
		userID   string
		device   string
		connID   string
		wantConn string
		wantErr  bool
	}{
		{"desktop route", "alice", "desktop", "dc-1", "dc-1", false},
		{"mobile route", "alice", "mobile", "mc-1", "mc-1", false},
		{"web route", "bob", "web", "wc-1", "wc-1", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NoError(t, c.SetRoute(ctx, tt.userID, tt.device, tt.connID))
			conn, err := c.GetRoute(ctx, tt.userID, tt.device)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantConn, conn)
			}
		})
	}
}

func TestSetRoute_Overwrites(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.SetRoute(ctx, "user", "desktop", "conn-old"))
	require.NoError(t, c.SetRoute(ctx, "user", "desktop", "conn-new"))

	conn, err := c.GetRoute(ctx, "user", "desktop")
	require.NoError(t, err)
	assert.Equal(t, "conn-new", conn)
}

func TestGetRouteForDeviceDoesNotFallbackToOtherDesktop(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.SetRoute(ctx, "user-target", "desktop:dev-a", "conn-a"))
	require.NoError(t, c.SetRoute(ctx, "user-target", "desktop:dev-b", "conn-b"))

	conn, err := c.GetRouteForDevice(ctx, "user-target", "desktop", "dev-b")
	require.NoError(t, err)
	assert.Equal(t, "conn-b", conn)

	_, err = c.GetRouteForDevice(ctx, "user-target", "desktop", "dev-c")
	assert.ErrorIs(t, err, redis.Nil)
}

// ==================== Online Status & Kick ====================

func TestIsOnline(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Initially offline
	online, err := c.IsOnline(ctx, "user-X")
	require.NoError(t, err)
	assert.False(t, online)

	// Set a route -> online
	require.NoError(t, c.SetRoute(ctx, "user-X", "desktop", "conn-1"))
	online, err = c.IsOnline(ctx, "user-X")
	require.NoError(t, err)
	assert.True(t, online)

	// Delete route -> offline
	require.NoError(t, c.DeleteRoute(ctx, "user-X", "desktop"))
	online, err = c.IsOnline(ctx, "user-X")
	require.NoError(t, err)
	assert.False(t, online)
}

func TestGetAllRoutes(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Empty
	routes, err := c.GetAllRoutes(ctx, "user-Y")
	require.NoError(t, err)
	assert.Empty(t, routes)

	// Populate
	require.NoError(t, c.SetRoute(ctx, "user-Y", "desktop", "dc-y"))
	require.NoError(t, c.SetRoute(ctx, "user-Y", "mobile", "mc-y"))

	routes, err = c.GetAllRoutes(ctx, "user-Y")
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"desktop": "dc-y", "mobile": "mc-y"}, routes)
}

func TestMarkKicked_IsKicked(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Not kicked initially
	kicked, err := c.IsKicked(ctx, "conn-k")
	require.NoError(t, err)
	assert.False(t, kicked)

	// Mark kicked
	require.NoError(t, c.MarkKicked(ctx, "conn-k"))
	kicked, err = c.IsKicked(ctx, "conn-k")
	require.NoError(t, err)
	assert.True(t, kicked)
}

func TestMarkKicked_Multiple(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.MarkKicked(ctx, "c1"))
	require.NoError(t, c.MarkKicked(ctx, "c2"))

	k1, err := c.IsKicked(ctx, "c1")
	require.NoError(t, err)
	assert.True(t, k1)

	k2, err := c.IsKicked(ctx, "c2")
	require.NoError(t, err)
	assert.True(t, k2)

	k3, err := c.IsKicked(ctx, "c3")
	require.NoError(t, err)
	assert.False(t, k3)
}

func TestMarkKicked_TTL(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.MarkKicked(ctx, "conn-ttl"))

	// Fast-forward 30s — key should still be alive
	mr.FastForward(30 * time.Second)
	kicked, err := c.IsKicked(ctx, "conn-ttl")
	require.NoError(t, err)
	assert.True(t, kicked)

	// Fast-forward past 60s — key should expire
	mr.FastForward(31 * time.Second)
	kicked, err = c.IsKicked(ctx, "conn-ttl")
	require.NoError(t, err)
	assert.False(t, kicked)
}

// ==================== Pending Tasks ====================

func TestPushPendingTask_PopPendingTasks(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Pop on empty queue
	tasks, err := c.PopPendingTasks(ctx, "user-T")
	require.NoError(t, err)
	assert.Empty(t, tasks)

	// Push valid JSON tasks
	t1 := `{"type":"msg","body":"hello"}`
	t2 := `{"type":"cmd","cmd":"run"}`
	require.NoError(t, c.PushPendingTask(ctx, "user-T", t1))
	require.NoError(t, c.PushPendingTask(ctx, "user-T", t2))

	// Count
	count, err := c.PendingTaskCount(ctx, "user-T")
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)

	// Pop (order: LPush means t2 then t1)
	tasks, err = c.PopPendingTasks(ctx, "user-T")
	require.NoError(t, err)
	assert.Len(t, tasks, 2)
	assert.Equal(t, t2, tasks[0])
	assert.Equal(t, t1, tasks[1])

	// Queue cleared after pop
	count, err = c.PendingTaskCount(ctx, "user-T")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)

	// Double pop returns empty
	tasks, err = c.PopPendingTasks(ctx, "user-T")
	require.NoError(t, err)
	assert.Empty(t, tasks)
}

func TestPushPendingTask_InvalidJSONFiltered(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.PushPendingTask(ctx, "user-B", `not-json`))
	require.NoError(t, c.PushPendingTask(ctx, "user-B", `{"valid":1}`))

	tasks, err := c.PopPendingTasks(ctx, "user-B")
	require.NoError(t, err)
	// invalid JSON is filtered out, only valid one remains
	assert.Len(t, tasks, 1)
	assert.JSONEq(t, `{"valid":1}`, tasks[0])
}

func TestPendingTaskCount_MultipleUsers(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.PushPendingTask(ctx, "u1", `{"a":1}`))
	require.NoError(t, c.PushPendingTask(ctx, "u1", `{"a":2}`))
	require.NoError(t, c.PushPendingTask(ctx, "u2", `{"b":1}`))

	c1, err := c.PendingTaskCount(ctx, "u1")
	require.NoError(t, err)
	assert.Equal(t, int64(2), c1)

	c2, err := c.PendingTaskCount(ctx, "u2")
	require.NoError(t, err)
	assert.Equal(t, int64(1), c2)

	c3, err := c.PendingTaskCount(ctx, "u3")
	require.NoError(t, err)
	assert.Equal(t, int64(0), c3)
}

func TestPendingTasksExpire(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.PushPendingTask(ctx, "user-ttl", `{"task_id":"task-ttl"}`))

	ttl, err := c.rdb.TTL(ctx, pendingTaskKey("user-ttl")).Result()
	require.NoError(t, err)
	require.Greater(t, ttl, time.Duration(0))
	require.LessOrEqual(t, ttl, config.PendingTaskTTL)

	mr.FastForward(config.PendingTaskTTL + time.Second)
	count, err := c.PendingTaskCount(ctx, "user-ttl")
	require.NoError(t, err)
	require.Equal(t, int64(0), count)
}

func TestPendingTargetTasksAreIsolatedByDeviceAndTarget(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-a", "dev-a", `{"task_id":"a1"}`))
	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-b", "dev-a", `{"task_id":"b1"}`))
	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-a", "dev-b", `{"task_id":"a2"}`))

	devATasks, err := c.PopPendingTargetTasksForDevice(ctx, "user-target", "dev-a")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{`{"task_id":"a1"}`, `{"task_id":"b1"}`}, devATasks)

	devASecondPop, err := c.PopPendingTargetTasksForDevice(ctx, "user-target", "dev-a")
	require.NoError(t, err)
	assert.Empty(t, devASecondPop)

	devBTasks, err := c.PopPendingTargetTasksForDevice(ctx, "user-target", "dev-b")
	require.NoError(t, err)
	require.Equal(t, []string{`{"task_id":"a2"}`}, devBTasks)
}

func TestPendingTargetTasksReplayFIFOAcrossTargetsForDevice(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	first := `{"task_id":"a1"}`
	second := `{"task_id":"b1"}`
	third := `{"task_id":"a2"}`
	otherDevice := `{"task_id":"other-device"}`
	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-a", "dev-a", first))
	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-b", "dev-a", second))
	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-a", "dev-a", third))
	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-a", "dev-b", otherDevice))

	listed, err := c.ListPendingTargetTasksForDevice(ctx, "user-target", "dev-a")
	require.NoError(t, err)
	require.Equal(t, []PendingTargetTask{
		{TargetID: "target-a", Payload: first},
		{TargetID: "target-b", Payload: second},
		{TargetID: "target-a", Payload: third},
	}, listed)

	popped, err := c.PopPendingTargetTasksForDevice(ctx, "user-target", "dev-a")
	require.NoError(t, err)
	require.Equal(t, []string{first, second, third}, popped)

	devBTasks, err := c.PopPendingTargetTasksForDevice(ctx, "user-target", "dev-b")
	require.NoError(t, err)
	require.Equal(t, []string{otherDevice}, devBTasks)
}

func TestPendingTargetTasksListDoesNotAckUntilExplicitRemove(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-a", "dev-a", `{"task_id":"a1"}`))
	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-b", "dev-a", `{"task_id":"b1"}`))
	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-a", "dev-b", `{"task_id":"a2"}`))

	devATasks, err := c.ListPendingTargetTasksForDevice(ctx, "user-target", "dev-a")
	require.NoError(t, err)
	require.ElementsMatch(t, []PendingTargetTask{
		{TargetID: "target-a", Payload: `{"task_id":"a1"}`},
		{TargetID: "target-b", Payload: `{"task_id":"b1"}`},
	}, devATasks)

	devASecondList, err := c.ListPendingTargetTasksForDevice(ctx, "user-target", "dev-a")
	require.NoError(t, err)
	require.ElementsMatch(t, devATasks, devASecondList)

	require.NoError(t, c.AckPendingTargetTask(ctx, "user-target", "target-a", "dev-a", `{"task_id":"a1"}`))
	devAAfterAck, err := c.ListPendingTargetTasksForDevice(ctx, "user-target", "dev-a")
	require.NoError(t, err)
	require.Equal(t, []PendingTargetTask{{TargetID: "target-b", Payload: `{"task_id":"b1"}`}}, devAAfterAck)

	devBTasks, err := c.ListPendingTargetTasksForDevice(ctx, "user-target", "dev-b")
	require.NoError(t, err)
	require.Equal(t, []PendingTargetTask{{TargetID: "target-a", Payload: `{"task_id":"a2"}`}}, devBTasks)
}

func TestPendingTargetTasksExpireWithIndex(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.PushPendingTargetTask(ctx, "user-target", "target-ttl", "dev-a", `{"task_id":"target-ttl"}`))

	taskTTL, err := c.rdb.TTL(ctx, pendingTargetTaskKey("user-target", "target-ttl", "dev-a")).Result()
	require.NoError(t, err)
	require.Greater(t, taskTTL, time.Duration(0))
	require.LessOrEqual(t, taskTTL, config.PendingTaskTTL)

	indexTTL, err := c.rdb.TTL(ctx, pendingTargetTaskIndexKey("user-target", "dev-a")).Result()
	require.NoError(t, err)
	require.Greater(t, indexTTL, time.Duration(0))
	require.LessOrEqual(t, indexTTL, config.PendingTaskTTL)

	mr.FastForward(config.PendingTaskTTL + time.Second)
	tasks, err := c.PopPendingTargetTasksForDevice(ctx, "user-target", "dev-a")
	require.NoError(t, err)
	require.Empty(t, tasks)
}

func TestPendingAgentControlsAreIsolatedByDevice(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-a", `{"kind":"permission.decide","approval_id":"approval-a"}`))
	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-b", `{"kind":"permission.decide","approval_id":"approval-b"}`))

	devAControls, err := c.PopPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Len(t, devAControls, 1)
	require.JSONEq(t, `{"kind":"permission.decide","approval_id":"approval-a"}`, devAControls[0])

	devASecondPop, err := c.PopPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Empty(t, devASecondPop)

	devBControls, err := c.PopPendingAgentControlsForDevice(ctx, "user-control", "dev-b")
	require.NoError(t, err)
	require.Len(t, devBControls, 1)
	require.JSONEq(t, `{"kind":"permission.decide","approval_id":"approval-b"}`, devBControls[0])
}

func TestPendingAgentControlsListDoesNotAckUntilExplicitRemove(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()
	devAControl := `{"kind":"permission.decide","approval_id":"approval-a"}`
	devBControl := `{"kind":"permission.decide","approval_id":"approval-b"}`

	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-a", devAControl))
	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-b", devBControl))

	devAControls, err := c.ListPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Len(t, devAControls, 1)
	require.JSONEq(t, devAControl, devAControls[0])

	devASecondList, err := c.ListPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Len(t, devASecondList, 1)
	require.JSONEq(t, devAControl, devASecondList[0])

	require.NoError(t, c.AckPendingAgentControl(ctx, "user-control", "dev-a", devAControl))
	devAAfterAck, err := c.ListPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Empty(t, devAAfterAck)

	devBControls, err := c.ListPendingAgentControlsForDevice(ctx, "user-control", "dev-b")
	require.NoError(t, err)
	require.Len(t, devBControls, 1)
	require.JSONEq(t, devBControl, devBControls[0])
}

func TestPendingAgentControlsDeduplicateExactPayloadForDevice(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()
	control := `{"kind":"permission.decide","approval_id":"approval-dedupe","edge_control":{"runId":"run-dedupe","requestId":"approval-dedupe","decision":"allow"}}`

	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-a", control))
	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-a", control))

	controls, err := c.PopPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Len(t, controls, 1)
	require.JSONEq(t, control, controls[0])
}

func TestPendingAgentControlsReplayFIFOForDevice(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()
	first := `{"kind":"permission.decide","approval_id":"approval-a"}`
	second := `{"kind":"permission.decide","approval_id":"approval-b"}`
	otherDevice := `{"kind":"permission.decide","approval_id":"approval-other"}`

	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-a", first))
	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-a", second))
	require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-b", otherDevice))

	listed, err := c.ListPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Equal(t, []string{first, second}, listed)

	popped, err := c.PopPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Equal(t, []string{first, second}, popped)

	devBControls, err := c.PopPendingAgentControlsForDevice(ctx, "user-control", "dev-b")
	require.NoError(t, err)
	require.Equal(t, []string{otherDevice}, devBControls)
}

func TestPendingAgentControlsAreCappedAndExpire(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	totalControls := config.PendingAgentControlQueueMaxLen + 2
	for i := 0; i < totalControls; i++ {
		control := fmt.Sprintf(`{"kind":"permission.decide","approval_id":"approval-%03d"}`, i)
		require.NoError(t, c.PushPendingAgentControl(ctx, "user-control", "dev-a", control))
	}

	ttl, err := c.rdb.TTL(ctx, pendingAgentControlKey("user-control", "dev-a")).Result()
	require.NoError(t, err)
	require.Greater(t, ttl, time.Duration(0))
	require.LessOrEqual(t, ttl, config.PendingAgentControlQueueTTL)

	controls, err := c.PopPendingAgentControlsForDevice(ctx, "user-control", "dev-a")
	require.NoError(t, err)
	require.Len(t, controls, config.PendingAgentControlQueueMaxLen)
	for i, control := range controls {
		expectedID := i + 2
		require.JSONEq(t, fmt.Sprintf(`{"kind":"permission.decide","approval_id":"approval-%03d"}`, expectedID), control)
	}
}

// ==================== Sequence Allocation ====================

func TestInitSeqIfAbsent_PeekSeq_AllocateSeq(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Init
	require.NoError(t, c.InitSeqIfAbsent(ctx, "sess-1", 100))

	// Peek
	seq, err := c.PeekSeq(ctx, "sess-1")
	require.NoError(t, err)
	assert.Equal(t, int64(100), seq)

	// Allocate increments
	s1, err := c.AllocateSeq(ctx, "sess-1")
	require.NoError(t, err)
	assert.Equal(t, int64(101), s1)

	s2, err := c.AllocateSeq(ctx, "sess-1")
	require.NoError(t, err)
	assert.Equal(t, int64(102), s2)

	// Peek after allocates
	seq, err = c.PeekSeq(ctx, "sess-1")
	require.NoError(t, err)
	assert.Equal(t, int64(102), seq)
}

func TestInitSeqIfAbsent_AlreadyExists(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.InitSeqIfAbsent(ctx, "sess-2", 50))
	// SetNX should not overwrite
	require.NoError(t, c.InitSeqIfAbsent(ctx, "sess-2", 999))

	seq, err := c.PeekSeq(ctx, "sess-2")
	require.NoError(t, err)
	assert.Equal(t, int64(50), seq, "should keep original value")
}

func TestPeekSeq_NotFound(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	_, err := c.PeekSeq(ctx, "nonexistent-sess")
	assert.ErrorIs(t, err, redis.Nil)
}

func TestAllocateSeq_Concurrent(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.InitSeqIfAbsent(ctx, "sess-conc", 0))

	var wg sync.WaitGroup
	results := make([]int64, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			seq, err := c.AllocateSeq(ctx, "sess-conc")
			require.NoError(t, err)
			results[idx] = seq
		}(i)
	}
	wg.Wait()

	// Verify all 20 values are unique and cover 1..20
	seen := make(map[int64]bool)
	for _, r := range results {
		assert.False(t, seen[r], "duplicate seq %d", r)
		seen[r] = true
		assert.True(t, r >= 1 && r <= 20, "seq %d out of range [1,20]", r)
	}
	assert.Len(t, seen, 20)

	// Final value should be 20
	seq, err := c.PeekSeq(ctx, "sess-conc")
	require.NoError(t, err)
	assert.Equal(t, int64(20), seq)
}

// TestPushPendingTask_CapKeepsNewestEvictsOldest guards the LTRIM direction
// regression: the old `LTRIM -max -1` kept the tail (oldest) and silently
// dropped freshly pushed tasks once the queue reached 256 entries.
func TestPushPendingTask_CapKeepsNewestEvictsOldest(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	for i := 0; i < 260; i++ {
		require.NoError(t, c.PushPendingTask(ctx, "user-cap", fmt.Sprintf(`{"i":%d}`, i)))
	}

	count, err := c.PendingTaskCount(ctx, "user-cap")
	require.NoError(t, err)
	assert.Equal(t, int64(256), count, "queue must cap at 256")

	tasks, err := c.PopPendingTasks(ctx, "user-cap")
	require.NoError(t, err)
	assert.Len(t, tasks, 256)
	assert.Equal(t, `{"i":259}`, tasks[0], "newest task must be retained at the head")
	assert.Equal(t, `{"i":4}`, tasks[255], "only the oldest 4 entries (0..3) may be evicted")
}

// ==================== Rate Limiting ====================

func TestCheckRateLimit_UnderLimit(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	for i := int64(1); i <= 5; i++ {
		count, exceeded, err := c.CheckRateLimit(ctx, "rl-user1", 10)
		require.NoError(t, err)
		assert.Equal(t, i, count)
		assert.False(t, exceeded)
	}
}

func TestCheckRateLimit_ExceedsLimit(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		_, exceeded, err := c.CheckRateLimit(ctx, "rl-user2", 2)
		require.NoError(t, err)
		if i < 2 {
			assert.False(t, exceeded, "request %d should be allowed", i+1)
		} else {
			assert.True(t, exceeded, "request %d should be rate limited", i+1)
		}
	}
}

func TestCheckRateLimit_IndependentKeys(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Exhaust user-A
	_, exceeded, err := c.CheckRateLimit(ctx, "rl-A", 0)
	require.NoError(t, err)
	assert.True(t, exceeded)

	// User-B is independent
	_, exceeded, err = c.CheckRateLimit(ctx, "rl-B", 10)
	require.NoError(t, err)
	assert.False(t, exceeded)
}

func TestCheckRateLimit_InvalidateOnExpiry(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	// Exhaust
	_, exceeded, err := c.CheckRateLimit(ctx, "rl-exp", 0)
	require.NoError(t, err)
	assert.True(t, exceeded)

	// Fast-forward past window
	mr.FastForward(61 * time.Second)

	// Should be allowed again (new window)
	_, exceeded, err = c.CheckRateLimit(ctx, "rl-exp", 10)
	require.NoError(t, err)
	assert.False(t, exceeded)
}

// ==================== Integration: Full Cache Workflow ====================
//
// These tests exercise multiple methods together to catch cross-method bugs.

func TestFullRouteLifecycle(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// User comes online via desktop + mobile
	require.NoError(t, c.SetRoute(ctx, "user-1", "desktop", "d-1"))
	require.NoError(t, c.SetRoute(ctx, "user-1", "mobile", "m-1"))

	online, err := c.IsOnline(ctx, "user-1")
	require.NoError(t, err)
	assert.True(t, online)

	all, err := c.GetAllRoutes(ctx, "user-1")
	require.NoError(t, err)
	assert.Len(t, all, 2)

	// Mobile disconnects
	require.NoError(t, c.DeleteRoute(ctx, "user-1", "mobile"))

	_, err = c.GetRoute(ctx, "user-1", "mobile")
	assert.ErrorIs(t, err, redis.Nil)

	// Still online via desktop
	online, err = c.IsOnline(ctx, "user-1")
	require.NoError(t, err)
	assert.True(t, online)

	// Desktop gets kicked
	require.NoError(t, c.MarkKicked(ctx, "d-1"))
	kicked, err := c.IsKicked(ctx, "d-1")
	require.NoError(t, err)
	assert.True(t, kicked)

	// Desktop disconnects after kick
	require.NoError(t, c.DeleteRoute(ctx, "user-1", "desktop"))
	online, err = c.IsOnline(ctx, "user-1")
	require.NoError(t, err)
	assert.False(t, online)
}

func TestSeqWorkflow(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	// Init
	require.NoError(t, c.InitSeqIfAbsent(ctx, "session-42", 0))

	// Peek initial
	seq, err := c.PeekSeq(ctx, "session-42")
	require.NoError(t, err)
	assert.Equal(t, int64(0), seq)

	// Allocate a few
	for i := int64(1); i <= 5; i++ {
		s, err := c.AllocateSeq(ctx, "session-42")
		require.NoError(t, err)
		assert.Equal(t, i, s)
	}

	// Peek
	seq, err = c.PeekSeq(ctx, "session-42")
	require.NoError(t, err)
	assert.Equal(t, int64(5), seq)
}

func TestInvalidateClearsSequence(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.InitSeqIfAbsent(ctx, "sess", 10))
	require.NoError(t, c.Invalidate(ctx, "session:seq:sess"))

	// After invalidation, peek should fail
	_, err := c.PeekSeq(ctx, "sess")
	assert.ErrorIs(t, err, redis.Nil)
}

func TestInvalidateClearsPendingTasks(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.PushPendingTask(ctx, "user", `{"x":1}`))
	require.NoError(t, c.Invalidate(ctx, "pending_tasks:user"))

	count, err := c.PendingTaskCount(ctx, "user")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}

func TestSetRoute_GetRoute_IsOnline_ConcurrentUsers(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	users := []struct {
		userID string
		device string
		connID string
	}{
		{"alice", "desktop", "a-d-1"},
		{"alice", "mobile", "a-m-1"},
		{"bob", "desktop", "b-d-1"},
		{"carol", "web", "c-w-1"},
	}

	for _, u := range users {
		require.NoError(t, c.SetRoute(ctx, u.userID, u.device, u.connID))
	}

	// Alice has 2 routes
	routes, err := c.GetAllRoutes(ctx, "alice")
	require.NoError(t, err)
	assert.Len(t, routes, 2)

	online, err := c.IsOnline(ctx, "alice")
	require.NoError(t, err)
	assert.True(t, online)

	// Bob has 1 route
	online, err = c.IsOnline(ctx, "bob")
	require.NoError(t, err)
	assert.True(t, online)

	conn, err := c.GetRoute(ctx, "bob", "desktop")
	require.NoError(t, err)
	assert.Equal(t, "b-d-1", conn)

	// Unknown user
	online, err = c.IsOnline(ctx, "dave")
	require.NoError(t, err)
	assert.False(t, online)
}

// ==================== Concurrent Access Tests ====================

// TestConcurrentRouteCRUD verifies that concurrent SetRoute/GetRoute/DeleteRoute
// operations on different users do not race or corrupt the Redis hash.
func TestConcurrentRouteCRUD(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const numGoroutines = 50
	var wg sync.WaitGroup

	// Each goroutine uses a unique userID+device pair.
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			userID := fmt.Sprintf("user-crud-%d", idx)
			device := fmt.Sprintf("device-%d", idx%3)
			connID := fmt.Sprintf("conn-%d", idx)

			// Set
			require.NoError(t, c.SetRoute(ctx, userID, device, connID))

			// Get — should find what we just set
			got, err := c.GetRoute(ctx, userID, device)
			require.NoError(t, err)
			require.Equal(t, connID, got)

			// Check online
			online, err := c.IsOnline(ctx, userID)
			require.NoError(t, err)
			require.True(t, online)

			// Delete
			require.NoError(t, c.DeleteRoute(ctx, userID, device))

			// Verify deleted
			_, err = c.GetRoute(ctx, userID, device)
			require.ErrorIs(t, err, redis.Nil)
		}(i)
	}
	wg.Wait()
}

// TestConcurrentTaskQueue verifies that concurrent PushPendingTask and
// PopPendingTasks across multiple users do not race.
func TestConcurrentTaskQueue(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const numUsers = 20
	const tasksPerUser = 10

	var wg sync.WaitGroup

	// Push tasks concurrently
	for u := 0; u < numUsers; u++ {
		wg.Add(1)
		go func(userIdx int) {
			defer wg.Done()
			userID := fmt.Sprintf("tq-user-%d", userIdx)
			for j := 0; j < tasksPerUser; j++ {
				payload := fmt.Sprintf(`{"task":%d,"user":%d}`, j, userIdx)
				require.NoError(t, c.PushPendingTask(ctx, userID, payload))
			}
		}(u)
	}
	wg.Wait()

	// Pop and verify each user
	for u := 0; u < numUsers; u++ {
		userID := fmt.Sprintf("tq-user-%d", u)
		count, err := c.PendingTaskCount(ctx, userID)
		require.NoError(t, err)
		assert.Equal(t, int64(tasksPerUser), count)

		tasks, err := c.PopPendingTasks(ctx, userID)
		require.NoError(t, err)
		assert.Len(t, tasks, tasksPerUser)
	}
}

// TestConcurrentCheckRateLimit verifies that the rate limit counter is
// race-free under concurrent access.
func TestConcurrentCheckRateLimit(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const limit = int64(50)
	var wg sync.WaitGroup
	var allowed atomic.Int64
	var blocked atomic.Int64

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, exceeded, err := c.CheckRateLimit(ctx, "rl-conc", limit)
			require.NoError(t, err)
			if exceeded {
				blocked.Add(1)
			} else {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()

	assert.Equal(t, limit, allowed.Load(), "exactly limit (50) should be allowed (count up to limit)")
	assert.Equal(t, 100-limit, blocked.Load(), "remaining should be blocked")
}

// TestConcurrentGetOrLoad verifies that GetOrLoad with singleflight correctly
// deduplicates concurrent loader invocations and returns consistent results.
func TestConcurrentGetOrLoad(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	lc := &loadCount{}

	// Windows flake 修复：原实现用 50ms loader sleep 作为 flight 窗口，
	// Windows runner 调度抖动可超过该窗口，迟到 goroutine 错过 flight 触发
	// 第二次加载（CI run 33346274196）。改为阻塞式 loader：释放时机由测试
	// 掌握，缓存写入前所有 goroutine 必然并入同一 flight。
	release := make(chan struct{})
	var started atomic.Int64
	var arrived atomic.Int64

	const goroutines = 30
	var wg sync.WaitGroup
	results := make(chan int, goroutines)

	// Release all goroutines at once
	barrier := make(chan struct{})
	var ready sync.WaitGroup
	ready.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-barrier
			ready.Done()
			ready.Wait()
			arrived.Add(1)
			v, err := GetOrLoad(c, ctx, "sf-conc-key", 30*time.Second, func(ctx context.Context) (int, error) {
				started.Add(1)
				<-release
				return lc.inc(), nil
			})
			require.NoError(t, err)
			results <- v
		}()
	}
	close(barrier)

	// flight 启动后即被 release 阻塞，缓存必然为空；等全部 goroutine
	// 进入 GetOrLoad 后再释放，保证所有调用要么并入同一 flight，要么
	// （极端迟到者）读到 flight 写入的缓存——loader 至多一次。
	require.Eventually(t, func() bool { return started.Load() >= 1 },
		5*time.Second, 5*time.Millisecond, "singleflight loader should have started")
	require.Eventually(t, func() bool { return arrived.Load() == goroutines },
		5*time.Second, 5*time.Millisecond, "all goroutines should have entered GetOrLoad")
	// settle 窗口：arrived 只保证进入 GetOrLoad，GET 本身可能还在飞；等一个
	// 有界窗口让所有 GET 在 flight 存活期间落地（miss→并入），再释放。
	settle := time.Now()
	require.Eventually(t, func() bool { return time.Since(settle) >= 200*time.Millisecond },
		2*time.Second, 10*time.Millisecond, "in-flight GETs should settle before release")
	close(release)

	wg.Wait()
	close(results)

	assert.Equal(t, 1, lc.count, "loader should be called exactly once (singleflight)")
	for v := range results {
		assert.Equal(t, 1, v, "all goroutines should get the same cached result")
	}
}

// TestPushPendingTargetTask_CapsAtMaxLen proves the #2119 P1 fix: both the
// per-target task list and the device-level order list are capped at
// pendingTaskQueueMaxLen entries (newest retained) so an offline target cannot
// grow Redis without bound. Ack semantics are unaffected (LRem by value).
func TestPushPendingTargetTask_CapsAtMaxLen(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const userID = "user-cap"
	const targetID = "target-cap"
	const deviceID = "dev-cap"

	// Push more than the cap.
	total := pendingTaskQueueMaxLen + 10
	for i := 0; i < total; i++ {
		payload := fmt.Sprintf(`{"seq":%d}`, i)
		require.NoError(t, c.PushPendingTargetTask(ctx, userID, targetID, deviceID, payload))
	}

	// Per-target task list must be capped.
	taskKey := pendingTargetTaskKey(userID, targetID, deviceID)
	taskLen, err := c.rdb.LLen(ctx, taskKey).Result()
	require.NoError(t, err)
	require.Equal(t, int64(pendingTaskQueueMaxLen), taskLen, "per-target queue exceeded cap")

	// Order list must be capped identically.
	orderKey := pendingTargetTaskOrderKey(userID, deviceID)
	orderLen, err := c.rdb.LLen(ctx, orderKey).Result()
	require.NoError(t, err)
	require.Equal(t, int64(pendingTaskQueueMaxLen), orderLen, "order queue exceeded cap")

	// Newest entries must survive (RPush + LTrim(-max,-1) keeps tail).
	tasks, err := c.ListPendingTargetTasksForDevice(ctx, userID, deviceID)
	require.NoError(t, err)
	require.Len(t, tasks, pendingTaskQueueMaxLen)
	// First surviving entry should be seq=10 (oldest evicted 0..9).
	require.JSONEq(t, `{"seq":10}`, tasks[0].Payload)
	// Last surviving entry should be the most recent push.
	require.JSONEq(t, fmt.Sprintf(`{"seq":%d}`, total-1), tasks[len(tasks)-1].Payload)
}

// TestPushPendingTargetTask_AckAfterCap proves that Ack still works correctly
// after the queue has been trimmed: LRem removes by value regardless of cap.
func TestPushPendingTargetTask_AckAfterCap(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const userID = "user-ack-cap"
	const targetID = "target-ack"
	const deviceID = "dev-ack"

	// Fill past cap so trimming occurs.
	for i := 0; i < pendingTaskQueueMaxLen+5; i++ {
		require.NoError(t, c.PushPendingTargetTask(ctx, userID, targetID, deviceID, fmt.Sprintf(`{"seq":%d}`, i)))
	}

	// Ack a surviving entry (seq=5 is within the kept window [5..260]).
	survivor := `{"seq":5}`
	require.NoError(t, c.AckPendingTargetTask(ctx, userID, targetID, deviceID, survivor))

	taskKey := pendingTargetTaskKey(userID, targetID, deviceID)
	taskLen, err := c.rdb.LLen(ctx, taskKey).Result()
	require.NoError(t, err)
	require.Equal(t, int64(pendingTaskQueueMaxLen-1), taskLen, "ack did not reduce length")

	orderKey := pendingTargetTaskOrderKey(userID, deviceID)
	orderLen, err := c.rdb.LLen(ctx, orderKey).Result()
	require.NoError(t, err)
	require.Equal(t, int64(pendingTaskQueueMaxLen-1), orderLen, "ack did not reduce order length")
}

// TestPushPendingTargetTask_EmptyQueueShortCircuit proves no panic or error
// when listing/acking on an empty queue after cap-related pushes.
func TestPushPendingTargetTask_EmptyQueueShortCircuit(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	tasks, err := c.ListPendingTargetTasksForDevice(ctx, "user-empty", "dev-empty")
	require.NoError(t, err)
	require.Empty(t, tasks)

	require.NoError(t, c.AckPendingTargetTask(ctx, "user-empty", "t", "dev-empty", `{"x":1}`))
}

// ==================== P2 Audit #2119: Empty Hash Cleanup ====================

func TestDeleteRoute_RemovesEmptyHash(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	// Single field: deleting it should remove the entire key
	require.NoError(t, c.SetRoute(ctx, "user-single", "desktop", "conn-1"))
	key := "device_route:user-single"
	assert.True(t, mr.Exists(key), "key should exist after SetRoute")

	require.NoError(t, c.DeleteRoute(ctx, "user-single", "desktop"))
	assert.False(t, mr.Exists(key), "empty hash key should be removed after last HDel")

	// IsOnline should report false without scanning residual keys
	online, err := c.IsOnline(ctx, "user-single")
	require.NoError(t, err)
	assert.False(t, online)
}

func TestDeleteRoute_KeepsHashWithRemainingFields(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	// Two fields: deleting one should keep the key
	require.NoError(t, c.SetRoute(ctx, "user-multi", "desktop", "dc-1"))
	require.NoError(t, c.SetRoute(ctx, "user-multi", "mobile", "mc-1"))
	key := "device_route:user-multi"

	require.NoError(t, c.DeleteRoute(ctx, "user-multi", "desktop"))
	assert.True(t, mr.Exists(key), "hash should remain when fields are left")

	// Remaining field is still accessible
	conn, err := c.GetRoute(ctx, "user-multi", "mobile")
	require.NoError(t, err)
	assert.Equal(t, "mc-1", conn)

	// Delete last field → key gone
	require.NoError(t, c.DeleteRoute(ctx, "user-multi", "mobile"))
	assert.False(t, mr.Exists(key), "empty hash key should be removed after last HDel")
}

func TestDeleteRoute_NonExistentFieldIsNoOp(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	// Delete on non-existent key should not error and not create anything
	require.NoError(t, c.DeleteRoute(ctx, "user-ghost", "desktop"))
	assert.False(t, mr.Exists("device_route:user-ghost"))

	// Delete non-existent field on existing hash should not remove the key
	require.NoError(t, c.SetRoute(ctx, "user-partial", "mobile", "mc-1"))
	require.NoError(t, c.DeleteRoute(ctx, "user-partial", "desktop"))
	assert.True(t, mr.Exists("device_route:user-partial"), "key should survive deleting a missing field")
}

// TestPopPendingTasks_AtomicDrainAndClear documents the pop contract after the
// LRange+Del race fix (#2136 P3-5): the drain and clear run as one server-side
// EVAL, so a task pushed by a concurrent writer lands on the fresh post-pop
// key instead of being silently deleted. The deterministic client-visible
// invariant: after a pop the queue is empty, and a push that arrives after the
// pop survives for the next pop.
func TestPopPendingTasks_AtomicDrainAndClear(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	t1 := `{"id":"t1"}`
	t2 := `{"id":"t2"}`
	require.NoError(t, c.PushPendingTask(ctx, "user-atomic", t1))
	require.NoError(t, c.PushPendingTask(ctx, "user-atomic", t2))

	popped, err := c.PopPendingTasks(ctx, "user-atomic")
	require.NoError(t, err)
	// LPush keeps newest at head, so the drain returns t2 then t1.
	require.Equal(t, []string{t2, t1}, popped)

	// Queue is cleared by the pop itself (no follow-up Del needed).
	again, err := c.PopPendingTasks(ctx, "user-atomic")
	require.NoError(t, err)
	require.Empty(t, again)

	// A push landing right after the pop starts a fresh queue and is kept.
	require.NoError(t, c.PushPendingTask(ctx, "user-atomic", t2))
	next, err := c.PopPendingTasks(ctx, "user-atomic")
	require.NoError(t, err)
	require.Equal(t, []string{t2}, next)
}

// CheckRateLimit must attach a TTL even on the very first call: the
// INCR+EXPIRE pair runs inside one Lua script, so a crash cannot strand a
// permanent ratelimit key (which would rate-limit the caller forever).
func TestCheckRateLimit_SetsTTLAtomically(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	_, exceeded, err := c.CheckRateLimit(ctx, "rl-ttl", 10)
	require.NoError(t, err)
	assert.False(t, exceeded)

	ttl := mr.TTL("ratelimit:rl-ttl")
	assert.Greater(t, ttl, time.Duration(0), "ratelimit key must carry a TTL after the first call")
	assert.LessOrEqual(t, ttl, 60*time.Second)
}
