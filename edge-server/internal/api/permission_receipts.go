package api

import (
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/deliverydedup"
)

const (
	permissionReceiptDefaultCapacity = deliverydedup.DefaultCapacity
	permissionReceiptDefaultTTL      = deliverydedup.DefaultTTL
)

// permissionRunRequestKey is the business identity that may accept only one
// modern control. A different control ID for the same run/request is a
// conflict, never a second application.
type permissionRunRequestKey struct {
	runID     string
	requestID string
}

// permissionReceipt is an applied modern permission decision. It is a warm,
// bounded replay receipt only; it is never authority and never a pending
// request.
type permissionReceipt struct {
	ControlID string
	HubTaskID string
	RunID     string
	RequestID string
	Decision  string
	Reason    string
	expiresAt time.Time
}

func (r permissionReceipt) sameAs(other permissionReceipt) bool {
	return r.ControlID == other.ControlID &&
		r.HubTaskID == other.HubTaskID &&
		r.RunID == other.RunID &&
		r.RequestID == other.RequestID &&
		r.Decision == other.Decision &&
		r.Reason == other.Reason
}

func (r permissionReceipt) runRequestKey() permissionRunRequestKey {
	return permissionRunRequestKey{runID: r.RunID, requestID: r.RequestID}
}

// permissionReceiptApplyResult reports the outcome of an atomic modern
// decision application. Full and Conflict are returned before the callback
// runs, so no broker/consume/event effect happens after those failures.
type permissionReceiptApplyResult struct {
	Receipt      permissionReceipt
	Applied      bool
	Deduplicated bool
	Conflict     bool
	Full         bool
}

// permissionReceiptCache is a process-local, bounded TTL cache of applied
// modern permission receipts. It deliberately has no durable state and does
// not retain pending requests: a cold miss must fall through to the existing
// broker/registry and return not-found instead of inventing success. Capacity
// pressure rejects a new decision before effects; it does not evict an applied
// receipt to admit another control.
type permissionReceiptCache struct {
	mu        sync.Mutex
	capacity  int
	ttl       time.Duration
	now       func() time.Time
	byControl map[string]permissionReceipt
	byRunReq  map[permissionRunRequestKey]struct{}
}

func newPermissionReceiptCache(capacity int, ttl time.Duration) *permissionReceiptCache {
	if capacity <= 0 {
		panic("api: permission receipt cache capacity must be > 0")
	}
	if ttl <= 0 {
		panic("api: permission receipt cache ttl must be > 0")
	}
	return &permissionReceiptCache{
		capacity:  capacity,
		ttl:       ttl,
		now:       time.Now,
		byControl: make(map[string]permissionReceipt, capacity),
		byRunReq:  make(map[permissionRunRequestKey]struct{}, capacity),
	}
}

func (c *permissionReceiptCache) withClock(clock func() time.Time) *permissionReceiptCache {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = clock
	return c
}

// apply atomically decides whether a modern request is a warm replay, a
// conflict, a capacity rejection, or a newly pending application. The callback
// runs while the cache lock is held so one winner performs every effect and
// concurrent retries observe a stable receipt afterwards.
func (c *permissionReceiptCache) apply(request permissionReceipt, applyFn func() bool) permissionReceiptApplyResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	request.ControlID = strings.TrimSpace(request.ControlID)
	request.HubTaskID = strings.TrimSpace(request.HubTaskID)
	request.RunID = strings.TrimSpace(request.RunID)
	request.RequestID = strings.TrimSpace(request.RequestID)
	request.Decision = strings.TrimSpace(request.Decision)
	if request.ControlID == "" || request.HubTaskID == "" || request.RunID == "" || request.RequestID == "" {
		return permissionReceiptApplyResult{}
	}
	c.purgeExpiredLocked(c.now())

	if stored, ok := c.byControl[request.ControlID]; ok {
		if stored.sameAs(request) {
			return permissionReceiptApplyResult{
				Receipt:      stored,
				Applied:      true,
				Deduplicated: true,
			}
		}
		return permissionReceiptApplyResult{Conflict: true}
	}
	if _, ok := c.byRunReq[request.runRequestKey()]; ok {
		return permissionReceiptApplyResult{Conflict: true}
	}
	if len(c.byControl) >= c.capacity {
		return permissionReceiptApplyResult{Full: true}
	}
	if !applyFn() {
		return permissionReceiptApplyResult{}
	}
	request.expiresAt = c.now().Add(c.ttl)
	c.storeLocked(request)
	return permissionReceiptApplyResult{
		Receipt: request,
		Applied: true,
	}
}

func (c *permissionReceiptCache) storeLocked(receipt permissionReceipt) {
	receipt.ControlID = strings.TrimSpace(receipt.ControlID)
	receipt.HubTaskID = strings.TrimSpace(receipt.HubTaskID)
	receipt.RunID = strings.TrimSpace(receipt.RunID)
	receipt.RequestID = strings.TrimSpace(receipt.RequestID)
	receipt.Decision = strings.TrimSpace(receipt.Decision)
	controlID := receipt.ControlID
	if controlID == "" {
		return
	}
	c.byControl[controlID] = receipt
	c.byRunReq[receipt.runRequestKey()] = struct{}{}
}

func (c *permissionReceiptCache) purgeExpiredLocked(now time.Time) {
	for id, receipt := range c.byControl {
		if now.After(receipt.expiresAt) {
			delete(c.byControl, id)
			delete(c.byRunReq, receipt.runRequestKey())
		}
	}
}

func (c *permissionReceiptCache) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.purgeExpiredLocked(c.now())
	return len(c.byControl)
}

func (h *Handler) ensurePermissionReceipts() *permissionReceiptCache {
	h.permissionRegistryMu.Lock()
	defer h.permissionRegistryMu.Unlock()
	if h.permissionReceipts == nil {
		h.permissionReceipts = newPermissionReceiptCache(
			permissionReceiptDefaultCapacity,
			permissionReceiptDefaultTTL,
		)
	}
	return h.permissionReceipts
}
