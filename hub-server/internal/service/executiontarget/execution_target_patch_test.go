package executiontarget

// #1545 — ExecutionTarget PATCH semantics: absent keeps, value sets
// (including port 0 and empty strings), null clears (device unbind, host
// reset, JSON fields reset to documented defaults).

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func TestExecutionTargetPatchOmittedFieldsUnchanged(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := newExecutionTargetSvc(t, db)

	// 空 patch（仅 name）→ 其他字段全部保持。
	target, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTargetPatch{
		Name: model.Patch("renamed"),
	})
	require.NoError(t, err)
	require.Equal(t, "renamed", target.Name)
	require.Equal(t, "local_edge", target.TargetType)
	require.Equal(t, "/workspace", target.WorkspaceRoot)
	require.Equal(t, `["/workspace"]`, target.WorkspaceAllowlist)
}

func TestExecutionTargetPatchPortResetToZero(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-port",
		OwnerID:            "owner-1",
		Name:               "Port target",
		TargetType:         "remote_ssh",
		Host:               "192.168.1.10",
		Port:               2222,
		WorkspaceAllowlist: `[]`,
		TrustLevel:         "remote",
		HealthState:        "unknown",
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
	svc := newExecutionTargetSvc(t, db)

	// port 0 是合法值（默认端口）——旧的 "!= 0 才更新" 无法表达。
	target, err := svc.Update(context.Background(), "target-port", "owner-1", &model.ExecutionTargetPatch{
		Port: model.Patch(0),
	})
	require.NoError(t, err)
	require.Equal(t, 0, target.Port)
}

func TestExecutionTargetPatchPortNullRejected(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := newExecutionTargetSvc(t, db)

	_, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTargetPatch{
		Port: model.PatchNull[int](),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.ErrorContains(t, err, "port cannot be null")
}

func TestExecutionTargetPatchDeviceUnbind(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "77777777-7777-4777-8777-777777777777"
	seedDevice(t, db, deviceID, "owner-1", "desktop")
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-bound",
		OwnerID:            "owner-1",
		DeviceID:           &deviceID,
		Name:               "Bound target",
		TargetType:         "local_edge",
		WorkspaceAllowlist: `[]`,
		TrustLevel:         "local",
		HealthState:        "unknown",
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
	svc := newExecutionTargetSvc(t, db)

	// null → 解绑。
	target, err := svc.Update(context.Background(), "target-bound", "owner-1", &model.ExecutionTargetPatch{
		DeviceID: model.PatchNull[string](),
	})
	require.NoError(t, err)
	require.Nil(t, target.DeviceID)

	// 空字符串也视为解绑（前端兼容）。
	target, err = svc.Update(context.Background(), "target-bound", "owner-1", &model.ExecutionTargetPatch{
		DeviceID: model.Patch(""),
	})
	require.NoError(t, err)
	require.Nil(t, target.DeviceID)
}

func TestExecutionTargetPatchHostClear(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-host",
		OwnerID:            "owner-1",
		Name:               "Host target",
		TargetType:         "local_edge",
		Host:               "10.0.0.5",
		WorkspaceAllowlist: `[]`,
		TrustLevel:         "local",
		HealthState:        "unknown",
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
	svc := newExecutionTargetSvc(t, db)

	// null → 清空 host。
	target, err := svc.Update(context.Background(), "target-host", "owner-1", &model.ExecutionTargetPatch{
		Host: model.PatchNull[string](),
	})
	require.NoError(t, err)
	require.Equal(t, "", target.Host)
}

func TestExecutionTargetPatchJSONNullResetsToDefault(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := newExecutionTargetSvc(t, db)

	// 先设置非默认值。
	target, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTargetPatch{
		WorkspaceAllowlist: model.Patch(json.RawMessage(`["/a","/b"]`)),
		Capabilities:       model.Patch(json.RawMessage(`{"x":1}`)),
		Metadata:           model.Patch(json.RawMessage(`{"k":"v"}`)),
	})
	require.NoError(t, err)
	require.JSONEq(t, `["/a","/b"]`, target.WorkspaceAllowlist)

	// null → 重置为文档默认（[] / {}）。
	target, err = svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTargetPatch{
		WorkspaceAllowlist: model.PatchNull[json.RawMessage](),
		Capabilities:       model.PatchNull[json.RawMessage](),
		Metadata:           model.PatchNull[json.RawMessage](),
	})
	require.NoError(t, err)
	require.JSONEq(t, `[]`, target.WorkspaceAllowlist)
	require.JSONEq(t, `{}`, target.Capabilities)
	require.JSONEq(t, `{}`, target.Metadata)
}

func TestExecutionTargetPatchCombinationConstraints(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := newExecutionTargetSvc(t, db)

	// remote 类型必须有 host。
	_, err := svc.Create(context.Background(), "owner-1", &model.ExecutionTarget{
		Name:       "Remote without host",
		TargetType: "remote_ssh",
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.ErrorContains(t, err, "requires a host")

	// device-routed 类型不能配 host。
	_, err = svc.Create(context.Background(), "owner-1", &model.ExecutionTarget{
		Name:       "Local with host",
		TargetType: "local_edge",
		Host:       "10.0.0.1",
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.ErrorContains(t, err, "cannot configure a host")

	// hub_relay 同理。
	_, err = svc.Create(context.Background(), "owner-1", &model.ExecutionTarget{
		Name:       "Relay with host",
		TargetType: "hub_relay",
		Host:       "10.0.0.1",
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
}
