package executiontarget

// #1544 — Health evidence contract. Every online state must trace to a
// specific evidence row; manual ping never writes online on its own;
// hub_relay proves an exact device route (not owner presence); stale writes
// cannot regress fresh evidence.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// fakeRouteCache models the redis route registry (device-exact).
type fakeRouteCache struct {
	routes map[string]string // key: userID:deviceType:deviceID → connID
}

var errFakeNoRoute = errors.New("fake: no route")

func (f *fakeRouteCache) GetRouteForDevice(_ context.Context, userID, deviceType, deviceID string) (string, error) {
	connID, ok := f.routes[userID+":"+deviceType+":"+deviceID]
	if !ok {
		return "", errFakeNoRoute
	}
	return connID, nil
}

func seedBoundTarget(t *testing.T, db *gorm.DB, id, ownerID, deviceID, targetType string) {
	t.Helper()
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 id,
		OwnerID:            ownerID,
		DeviceID:           &deviceID,
		Name:               id,
		TargetType:         targetType,
		WorkspaceAllowlist: `[]`,
		TrustLevel:         "local",
		HealthState:        "unknown",
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
}

// TestPingLocalEdgeBoundProbeRoute: 绑定设备的 local_edge Ping 走 route
// probe（真实探测）；无 route 时失败并写 offline evidence，不得 online。
func TestPingLocalEdgeBoundProbeRoute(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "22222222-2222-4222-8222-222222222222"
	seedDevice(t, db, deviceID, "owner-1", "desktop")
	seedBoundTarget(t, db, "target-local", "owner-1", deviceID, "local_edge")

	cache := &fakeRouteCache{routes: map[string]string{}}
	svc := newExecutionTargetSvc(t, db)
	svc.SetCache(cache)

	// 无 route：探测失败，evidence=offline(no_route)，投影非 online。
	err := svc.Ping(context.Background(), "target-local", "owner-1")
	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	assertLatestEvidence(t, db, "target-local", dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "owner-1:desktop:"+deviceID)

	got, err := svc.Get(context.Background(), "target-local", "owner-1")
	require.NoError(t, err)
	require.False(t, got.IsOnline)

	// 目标 device 有 route：探测成功，evidence=online。
	cache.routes["owner-1:desktop:"+deviceID] = "conn-1"
	require.NoError(t, svc.Ping(context.Background(), "target-local", "owner-1"))
	assertLatestEvidence(t, db, "target-local", dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOnline, "owner-1:desktop:"+deviceID)

	got, err = svc.Get(context.Background(), "target-local", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "online", got.HealthState)
	require.True(t, got.IsOnline)
}

// TestPingHubRelayRequiresExactDeviceRoute: owner 有任意连接不算数——目标
// device 自身必须有 route；多设备同用户只认对应设备。
func TestPingHubRelayRequiresExactDeviceRoute(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	targetDeviceID := "33333333-3333-4333-8333-333333333333"
	otherDeviceID := "33333333-9999-4999-8999-999999999999"
	seedDevice(t, db, targetDeviceID, "owner-1", "desktop")
	seedDevice(t, db, otherDeviceID, "owner-1", "desktop")
	seedBoundTarget(t, db, "target-relay", "owner-1", targetDeviceID, "hub_relay")

	cache := &fakeRouteCache{routes: map[string]string{}}
	svc := newExecutionTargetSvc(t, db)
	svc.SetCache(cache)

	// owner 的另一个设备在线，目标设备不在 → 不得 online。
	cache.routes["owner-1:desktop:"+otherDeviceID] = "conn-other"
	err := svc.Ping(context.Background(), "target-relay", "owner-1")
	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	assertLatestEvidence(t, db, "target-relay", dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "owner-1:desktop:"+targetDeviceID)

	got, err := svc.Get(context.Background(), "target-relay", "owner-1")
	require.NoError(t, err)
	require.False(t, got.IsOnline)

	// 目标设备上线 → 只有这时才 online。
	cache.routes["owner-1:desktop:"+targetDeviceID] = "conn-target"
	require.NoError(t, svc.Ping(context.Background(), "target-relay", "owner-1"))
	assertLatestEvidence(t, db, "target-relay", dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOnline, "owner-1:desktop:"+targetDeviceID)

	got, err = svc.Get(context.Background(), "target-relay", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "online", got.HealthState)
}

// TestPingHubRelayRequiresBinding: hub_relay 无绑定设备时无法证明 route。
func TestPingHubRelayRequiresBinding(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedBoundTarget(t, db, "target-relay-unbound", "owner-1", "", "hub_relay")

	svc := newExecutionTargetSvc(t, db)
	svc.SetCache(&fakeRouteCache{routes: map[string]string{}})

	err := svc.Ping(context.Background(), "target-relay-unbound", "owner-1")
	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	assertLatestEvidence(t, db, "target-relay-unbound", dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "")
}

// TestPingHubRelayMissingBoundDevice: 绑定 device 行不存在时 route 证明失败。
func TestPingHubRelayMissingBoundDevice(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "44444444-4444-4444-8444-444444444444"
	seedBoundTarget(t, db, "target-relay-ghost", "owner-1", deviceID, "hub_relay")

	svc := newExecutionTargetSvc(t, db)
	svc.SetCache(&fakeRouteCache{routes: map[string]string{}})

	err := svc.Ping(context.Background(), "target-relay-ghost", "owner-1")
	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	assertLatestEvidence(t, db, "target-relay-ghost", dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "")
}

// TestExecutionTargetEvidenceExpiryProjectedStale: 证据过期后 Get 投影为
// stale（freshness 窗口语义）；证据缺失时按绑定与否投影 registered/unknown。
func TestExecutionTargetEvidenceExpiryProjectedStale(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "55555555-5555-4555-8555-555555555555"
	seedDevice(t, db, deviceID, "owner-1", "desktop")
	seedBoundTarget(t, db, "target-stale", "owner-1", deviceID, "local_edge")

	svc := newExecutionTargetSvc(t, db)

	// 无证据 + 已绑定 → registered（已注册未证明在线，不是 online）。
	got, err := svc.Get(context.Background(), "target-stale", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "registered", got.HealthState)
	require.False(t, got.IsOnline)

	// 无证据 + 未绑定 → unknown。
	seedExecutionTarget(t, db, "target-unbound", "owner-1")
	got, err = svc.Get(context.Background(), "target-unbound", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "unknown", got.HealthState)

	// registration evidence 写入后过期 → stale。
	require.NoError(t, repository.UpsertExecutionTargetEvidence(db, &model.ExecutionTargetEvidence{
		TargetID:   "target-stale",
		Source:     dispatch.EvidenceSourceRegistration,
		Status:     dispatch.EvidenceStatusOnline,
		ObservedAt: time.Now().Add(-3 * time.Minute),
		ExpiresAt:  func() *time.Time { e := time.Now().Add(-time.Minute); return &e }(),
	}))
	got, err = svc.Get(context.Background(), "target-stale", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "stale", got.HealthState)
	require.False(t, got.IsOnline)
	require.Nil(t, got.LastSeenAt)
}

// TestUpsertEvidenceCASRejectsOlderObservedAt: 旧证据不能覆盖新证据
// （并发 probe/heartbeat 的旧写不回归新鲜状态）。
func TestUpsertEvidenceCASRejectsOlderObservedAt(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-cas", "owner-1")

	fresh := time.Now()
	older := fresh.Add(-time.Minute)

	require.NoError(t, repository.UpsertExecutionTargetEvidence(db, &model.ExecutionTargetEvidence{
		TargetID:   "target-cas",
		Source:     dispatch.EvidenceSourceProbe,
		Status:     dispatch.EvidenceStatusOnline,
		ObservedAt: fresh,
	}))
	// 旧写（observed_at 更早）被 CAS 拒绝。
	require.NoError(t, repository.UpsertExecutionTargetEvidence(db, &model.ExecutionTargetEvidence{
		TargetID:   "target-cas",
		Source:     dispatch.EvidenceSourceProbe,
		Status:     dispatch.EvidenceStatusOffline,
		ObservedAt: older,
	}))

	ev, err := repository.GetExecutionTargetEvidence(db, "target-cas")
	require.NoError(t, err)
	require.Equal(t, dispatch.EvidenceStatusOnline, ev.Status)
	require.True(t, ev.ObservedAt.Equal(fresh), "older observed_at must not overwrite fresh evidence")
}

// TestDispatchAndAPIProjectionAgree: 调度器与 Get/List 使用同一投影
// （dispatch.IsDispatchableTargetHealth 只放行 online/healthy）。
func TestDispatchAndAPIProjectionAgree(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "66666666-6666-4666-8666-666666666666"
	seedDevice(t, db, deviceID, "owner-1", "desktop")
	seedBoundTarget(t, db, "target-dispatch", "owner-1", deviceID, "local_edge")
	svc := newExecutionTargetSvc(t, db)

	now := time.Now()

	// 新鲜 registration evidence：API 投影 online，调度放行。
	require.NoError(t, repository.UpsertExecutionTargetEvidence(db, &model.ExecutionTargetEvidence{
		TargetID:   "target-dispatch",
		Source:     dispatch.EvidenceSourceRegistration,
		Status:     dispatch.EvidenceStatusOnline,
		ObservedAt: now,
		ExpiresAt:  func() *time.Time { e := now.Add(dispatch.DesktopTargetStaleAfter); return &e }(),
	}))
	got, err := svc.Get(context.Background(), "target-dispatch", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "online", got.HealthState)
	require.True(t, dispatch.IsDispatchableTargetHealth(got.HealthState), "fresh online must be dispatchable")

	// 过期证据（observed_at 最新但窗口已过）：API 投影 stale，调度拒绝。
	require.NoError(t, repository.UpsertExecutionTargetEvidence(db, &model.ExecutionTargetEvidence{
		TargetID:   "target-dispatch",
		Source:     dispatch.EvidenceSourceRegistration,
		Status:     dispatch.EvidenceStatusOnline,
		ObservedAt: now.Add(time.Minute),
		ExpiresAt:  func() *time.Time { e := now.Add(-time.Minute); return &e }(),
	}))
	got, err = svc.Get(context.Background(), "target-dispatch", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "stale", got.HealthState)
	require.False(t, dispatch.IsDispatchableTargetHealth(got.HealthState), "stale must not be dispatchable")
}
