package cache

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

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
			v, err := GetOrLoad(c, ctx, "sf-key", 30*time.Second, func(ctx context.Context) (int, error) {
				time.Sleep(100 * time.Millisecond) // keep sf.Do open for others to join
				lc.inc()
				return 42, nil
			})
			require.NoError(t, err)
			results[idx] = v
		}(i)
	}
	start.Wait()
	close(barrier)
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
		name      string
		userID    string
		device    string
		connID    string
		wantConn  string
		wantErr   bool
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
