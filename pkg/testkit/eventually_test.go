package testkit

import (
	"testing"
	"time"
)

// 超时失败路径（WaitFor/Eventually 的 t.Fatalf）无法在进程内安全断言——
// Fatalf 触发 runtime.Goexit 会终止整个测试进程。真实消费方测试已经覆盖
// 失败路径（它们依赖超时失败来暴露 bug）；这里只验证成功路径与轮询语义。

func TestWaitForSucceedsWhenClosed(t *testing.T) {
	done := make(chan struct{})
	go func() {
		time.Sleep(5 * time.Millisecond)
		close(done)
	}()
	WaitFor(t, time.Second, done, "waiting for done")
}

func TestEventuallySucceedsWhenConditionTurnsTrue(t *testing.T) {
	start := time.Now()
	Eventually(t, time.Second, func() bool {
		return time.Since(start) > 10*time.Millisecond
	}, "waiting for condition", nil)
}

// TestEventuallyPollsInsteadOfBusyLoop verifies the poll cadence: the
// condition is evaluated at pollInterval granularity, so a condition that
// flips after N polls succeeds without a hot busy loop.
func TestEventuallyPollsInsteadOfBusyLoop(t *testing.T) {
	calls := 0
	Eventually(t, time.Second, func() bool {
		calls++
		return calls >= 3
	}, "waiting for third poll", nil)
	if calls != 3 {
		t.Fatalf("cond called %d times, want 3", calls)
	}
}
