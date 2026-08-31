package cache

import (
	"context"
	"encoding/json"

	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/config"
)

// Residual pure-helper peel #1123: pending offline task/control queue helpers.

func pendingTaskKey(userID string) string { return "pending_tasks:" + userID }

func pendingTargetTaskKey(userID, targetID, deviceID string) string {
	return "pending_tasks:" + userID + ":device:" + deviceID + ":target:" + targetID
}

func pendingTargetTaskIndexKey(userID, deviceID string) string {
	return "pending_tasks:" + userID + ":device:" + deviceID + ":targets"
}

func pendingTargetTaskOrderKey(userID, deviceID string) string {
	return "pending_tasks:" + userID + ":device:" + deviceID + ":target_order"
}

func pendingAgentControlKey(userID, deviceID string) string {
	return "pending_controls:" + userID + ":device:" + deviceID
}

// PendingTargetTask is a target/device-bound pending dispatch payload listed
// from Redis before the caller explicitly acknowledges it.
type PendingTargetTask struct {
	TargetID string
	Payload  string
}

type pendingTargetTaskOrderEntry struct {
	TargetID string `json:"target_id"`
	Payload  string `json:"payload"`
}

func encodePendingTargetTaskOrderEntry(targetID, payload string) (string, error) {
	data, err := json.Marshal(pendingTargetTaskOrderEntry{TargetID: targetID, Payload: payload})
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func decodePendingTargetTaskOrderEntry(data string) (PendingTargetTask, bool) {
	var entry pendingTargetTaskOrderEntry
	if err := json.Unmarshal([]byte(data), &entry); err != nil || entry.TargetID == "" {
		return PendingTargetTask{}, false
	}
	var raw json.RawMessage
	if json.Unmarshal([]byte(entry.Payload), &raw) != nil {
		return PendingTargetTask{}, false
	}
	return PendingTargetTask(entry), true
}

// pendingTaskQueueMaxLen bounds the per-user offline pending task list so a
// disconnected desktop cannot grow Redis without limit. Mirrors the control
// queue cap (PendingAgentControlQueueMaxLen = 256) so both offline queues share
// the same backpressure budget. Defined locally because the config package is
// out of this lane's edit scope; if config ownership is later centralized,
// move this constant next to PendingAgentControlQueueMaxLen.
const pendingTaskQueueMaxLen = 256

// PushPendingTask pushes a task JSON to the user's offline pending queue. The
// queue is capped at pendingTaskQueueMaxLen entries via LTRIM (keeping the most
// recent) so a long-offline desktop cannot grow Redis without bound; when the
// cap is hit the oldest entry is evicted. The TTL is refreshed on every push.
func (c *Client) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	key := pendingTaskKey(userID)
	pipe := c.rdb.TxPipeline()
	pipe.LPush(ctx, key, taskJSON)
	// LPUSH prepends, so the newest entry sits at index 0 and the oldest at
	// the tail. Keep the HEAD [0, maxLen-1]: newest retained, oldest evicted.
	// (The previous LTRIM -maxLen -1 kept the tail = oldest — inverted the
	// documented direction and silently dropped freshly pushed tasks.)
	pipe.LTrim(ctx, key, 0, int64(pendingTaskQueueMaxLen-1))
	pipe.Expire(ctx, key, config.PendingTaskTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// PushPendingTaskWithEviction pushes a task JSON and reports whether the cap
// evicted an older entry. Returns (evicted bool, err error). Used by the
// requeue path in app/events.go to increment a dropped counter when the
// offline queue is saturated.
func (c *Client) PushPendingTaskWithEviction(ctx context.Context, userID, taskJSON string) (bool, error) {
	key := pendingTaskKey(userID)
	pipe := c.rdb.TxPipeline()
	// Capture the LPush result (new list length BEFORE the LTRIM runs) so the
	// caller can detect eviction. In a TxPipeline each Cmd is returned at
	// Exec time; the LPush length is the post-push, pre-trim count, so when
	// it exceeds the cap, LTRIM evicted at least one older entry.
	pushedLenCmd := pipe.LPush(ctx, key, taskJSON)
	pipe.LTrim(ctx, key, 0, int64(pendingTaskQueueMaxLen-1))
	pipe.Expire(ctx, key, config.PendingTaskTTL)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return false, err
	}
	pushedLen := pushedLenCmd.Val()
	return pushedLen > pendingTaskQueueMaxLen, nil
}

// popAllScript drains and deletes a Redis list in one atomic step, so a task
// pushed concurrently lands on the fresh post-pop key instead of being wiped
// by a read-then-delete pair (the previous LRange+Del could delete a just-
// pushed entry, silently losing a queued task).
var popAllScript = redis.NewScript(`
local items = redis.call('LRANGE', KEYS[1], 0, -1)
redis.call('DEL', KEYS[1])
return items
`)

// popAll atomically returns all list elements for key and clears the key.
func (c *Client) popAll(ctx context.Context, key string) ([]string, error) {
	return popAllScript.Run(ctx, c.rdb, []string{key}).StringSlice()
}

// PopPendingTasks pops all pending tasks for a user and clears the queue.
func (c *Client) PopPendingTasks(ctx context.Context, userID string) ([]string, error) {
	tasks, err := c.popAll(ctx, pendingTaskKey(userID))
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(tasks))
	for _, t := range tasks {
		var raw json.RawMessage
		if json.Unmarshal([]byte(t), &raw) == nil {
			result = append(result, t)
		}
	}
	return result, nil
}

// PendingTaskCount returns the number of pending tasks for a user.
func (c *Client) PendingTaskCount(ctx context.Context, userID string) (int64, error) {
	return c.rdb.LLen(ctx, pendingTaskKey(userID)).Result()
}

// PushPendingTargetTask pushes a task JSON to a target/device-specific offline
// queue so target-bound dispatch cannot be replayed to a different desktop.
// Both the per-target task list and the device-level order list are capped at
// pendingTaskQueueMaxLen entries (newest retained) to bound Redis growth when
// a target stays offline indefinitely.
func (c *Client) PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	indexKey := pendingTargetTaskIndexKey(userID, deviceID)
	orderKey := pendingTargetTaskOrderKey(userID, deviceID)
	taskKey := pendingTargetTaskKey(userID, targetID, deviceID)
	orderEntry, err := encodePendingTargetTaskOrderEntry(targetID, taskJSON)
	if err != nil {
		return err
	}
	pipe := c.rdb.TxPipeline()
	pipe.SAdd(ctx, indexKey, targetID)
	pipe.Expire(ctx, indexKey, config.PendingTaskTTL)
	pipe.RPush(ctx, taskKey, taskJSON)
	// Cap per-target queue to pendingTaskQueueMaxLen (keeping newest via RPush
	// + LTrim tail). Mirrors PushPendingTask backpressure; Ack path is LRem
	// by value so trimming oldest entries does not affect consumption semantics.
	pipe.LTrim(ctx, taskKey, int64(-pendingTaskQueueMaxLen), -1)
	pipe.Expire(ctx, taskKey, config.PendingTaskTTL)
	pipe.RPush(ctx, orderKey, orderEntry)
	// Same cap for the order queue so it cannot outgrow the per-target queue.
	pipe.LTrim(ctx, orderKey, int64(-pendingTaskQueueMaxLen), -1)
	pipe.Expire(ctx, orderKey, config.PendingTaskTTL)
	_, err = pipe.Exec(ctx)
	return err
}

// ListPendingTargetTasksForDevice lists target-bound pending tasks for one
// device without deleting them. Call AckPendingTargetTask only after durable
// dispatch state has been persisted.
func (c *Client) ListPendingTargetTasksForDevice(ctx context.Context, userID, deviceID string) ([]PendingTargetTask, error) {
	if tasks, ok, err := c.listPendingTargetTasksFromOrder(ctx, userID, deviceID); err != nil || ok {
		return tasks, err
	}
	return c.listPendingTargetTasksFromIndex(ctx, userID, deviceID)
}

func (c *Client) listPendingTargetTasksFromOrder(ctx context.Context, userID, deviceID string) ([]PendingTargetTask, bool, error) {
	orderKey := pendingTargetTaskOrderKey(userID, deviceID)
	entries, err := c.rdb.LRange(ctx, orderKey, 0, -1).Result()
	if err != nil {
		return nil, false, err
	}
	if len(entries) == 0 {
		return nil, false, nil
	}
	result := make([]PendingTargetTask, 0, len(entries))
	for _, entry := range entries {
		if task, ok := decodePendingTargetTaskOrderEntry(entry); ok {
			result = append(result, task)
		}
	}
	return result, true, nil
}

func (c *Client) listPendingTargetTasksFromIndex(ctx context.Context, userID, deviceID string) ([]PendingTargetTask, error) {
	indexKey := pendingTargetTaskIndexKey(userID, deviceID)
	targetIDs, err := c.rdb.SMembers(ctx, indexKey).Result()
	if err != nil {
		return nil, err
	}
	result := make([]PendingTargetTask, 0)
	for _, targetID := range targetIDs {
		key := pendingTargetTaskKey(userID, targetID, deviceID)
		tasks, err := c.rdb.LRange(ctx, key, 0, -1).Result()
		if err != nil {
			return nil, err
		}
		for _, t := range tasks {
			var raw json.RawMessage
			if json.Unmarshal([]byte(t), &raw) == nil {
				result = append(result, PendingTargetTask{TargetID: targetID, Payload: t})
			}
		}
	}
	return result, nil
}

// AckPendingTargetTask removes one target/device-bound payload after it has
// been durably marked dispatched.
func (c *Client) AckPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	indexKey := pendingTargetTaskIndexKey(userID, deviceID)
	orderKey := pendingTargetTaskOrderKey(userID, deviceID)
	taskKey := pendingTargetTaskKey(userID, targetID, deviceID)
	orderEntry, err := encodePendingTargetTaskOrderEntry(targetID, taskJSON)
	if err != nil {
		return err
	}
	pipe := c.rdb.TxPipeline()
	pipe.LRem(ctx, taskKey, 1, taskJSON)
	pipe.LRem(ctx, orderKey, 1, orderEntry)
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}
	count, err := c.rdb.LLen(ctx, taskKey).Result()
	if err != nil {
		return err
	}
	if count == 0 {
		pipe := c.rdb.TxPipeline()
		pipe.Del(ctx, taskKey)
		pipe.SRem(ctx, indexKey, targetID)
		_, err = pipe.Exec(ctx)
	}
	if err != nil {
		return err
	}
	orderCount, err := c.rdb.LLen(ctx, orderKey).Result()
	if err != nil {
		return err
	}
	if orderCount == 0 {
		return c.rdb.Del(ctx, orderKey).Err()
	}
	return err
}

// PopPendingTargetTasksForDevice pops all target-bound pending tasks for one
// device and clears only that device's target queues.
func (c *Client) PopPendingTargetTasksForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	if tasks, ok, err := c.listPendingTargetTasksFromOrder(ctx, userID, deviceID); err != nil || ok {
		if err != nil {
			return nil, err
		}
		if err := c.clearPendingTargetTaskQueuesForDevice(ctx, userID, deviceID); err != nil {
			return nil, err
		}
		result := make([]string, 0, len(tasks))
		for _, task := range tasks {
			result = append(result, task.Payload)
		}
		return result, nil
	}

	indexKey := pendingTargetTaskIndexKey(userID, deviceID)
	targetIDs, err := c.rdb.SMembers(ctx, indexKey).Result()
	if err != nil {
		return nil, err
	}
	result := make([]string, 0)
	for _, targetID := range targetIDs {
		key := pendingTargetTaskKey(userID, targetID, deviceID)
		tasks, err := c.rdb.LRange(ctx, key, 0, -1).Result()
		if err != nil {
			return nil, err
		}
		if len(tasks) > 0 {
			c.rdb.Del(ctx, key)
		}
		c.rdb.SRem(ctx, indexKey, targetID)
		for _, t := range tasks {
			var raw json.RawMessage
			if json.Unmarshal([]byte(t), &raw) == nil {
				result = append(result, t)
			}
		}
	}
	if len(targetIDs) == 0 {
		c.rdb.Del(ctx, indexKey)
	}
	return result, nil
}

func (c *Client) clearPendingTargetTaskQueuesForDevice(ctx context.Context, userID, deviceID string) error {
	indexKey := pendingTargetTaskIndexKey(userID, deviceID)
	orderKey := pendingTargetTaskOrderKey(userID, deviceID)
	targetIDs, err := c.rdb.SMembers(ctx, indexKey).Result()
	if err != nil {
		return err
	}
	pipe := c.rdb.TxPipeline()
	for _, targetID := range targetIDs {
		pipe.Del(ctx, pendingTargetTaskKey(userID, targetID, deviceID))
	}
	pipe.Del(ctx, orderKey)
	pipe.Del(ctx, indexKey)
	_, err = pipe.Exec(ctx)
	return err
}

// PushPendingAgentControl pushes a control JSON to a device-specific offline
// queue so approval decisions are never replayed to a different desktop.
func (c *Client) PushPendingAgentControl(ctx context.Context, userID, deviceID, controlJSON string) error {
	key := pendingAgentControlKey(userID, deviceID)
	pipe := c.rdb.TxPipeline()
	pipe.LRem(ctx, key, 0, controlJSON)
	pipe.RPush(ctx, key, controlJSON)
	pipe.LTrim(ctx, key, int64(-config.PendingAgentControlQueueMaxLen), -1)
	pipe.Expire(ctx, key, config.PendingAgentControlQueueTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// ListPendingAgentControlsForDevice lists queued controls for one device
// without removing them. Call AckPendingAgentControl after WebSocket enqueue
// succeeds.
func (c *Client) ListPendingAgentControlsForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	key := pendingAgentControlKey(userID, deviceID)
	controls, err := c.rdb.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(controls))
	for _, control := range controls {
		var raw json.RawMessage
		if json.Unmarshal([]byte(control), &raw) == nil {
			result = append(result, control)
		}
	}
	return result, nil
}

// AckPendingAgentControl removes one exact queued control after it has been
// accepted by the WebSocket send queue.
func (c *Client) AckPendingAgentControl(ctx context.Context, userID, deviceID, controlJSON string) error {
	key := pendingAgentControlKey(userID, deviceID)
	pipe := c.rdb.TxPipeline()
	pipe.LRem(ctx, key, 1, controlJSON)
	remaining := pipe.LLen(ctx, key)
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}
	if remaining.Val() == 0 {
		return c.rdb.Del(ctx, key).Err()
	}
	return nil
}

// PopPendingAgentControlsForDevice pops all queued controls for one device and
// clears only that device's control queue.
func (c *Client) PopPendingAgentControlsForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	controls, err := c.popAll(ctx, pendingAgentControlKey(userID, deviceID))
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(controls))
	for _, control := range controls {
		var raw json.RawMessage
		if json.Unmarshal([]byte(control), &raw) == nil {
			result = append(result, control)
		}
	}
	return result, nil
}
