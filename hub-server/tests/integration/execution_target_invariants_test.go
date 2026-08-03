//go:build integration

package integration

// #1545 — ExecutionTarget DB invariants on PostgreSQL:
//   - concurrent same-name creates: exactly one wins (partial unique index)
//   - soft-deleted names are reusable
//   - invalid enum/port values are rejected by the DB schema itself
//   - PATCH three-state semantics over the HTTP API

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestExecutionTarget_ConcurrentSameNameCreate: 100 个并发同名创建最终只有
// 一个成功（migration 0060 的 partial unique index 是权威守卫）；失败方
// 拿到稳定业务错误（非裸 500）。
func TestExecutionTarget_ConcurrentSameNameCreate(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "et_cc1", "pass1234", "ET_CC")

	const workers = 100
	var wg sync.WaitGroup
	statuses := make([]int, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := postAuth("/web/execution-targets", u.Token, map[string]interface{}{
				"name":        "concurrent-dup",
				"target_type": "local_edge",
			})
			statuses[i] = w.StatusCode
			w.Body.Close()
		}(i)
	}
	wg.Wait()

	created := 0
	badRequest := 0
	for _, s := range statuses {
		switch s {
		case http.StatusCreated:
			created++
		case http.StatusBadRequest:
			badRequest++
		default:
			t.Errorf("unexpected status %d", s)
		}
	}
	require.Equal(t, 1, created, "exactly one concurrent same-name create must win")
	require.Equal(t, workers-1, badRequest, "losers must get the stable business error")

	// DB 里只有一行。
	var count int64
	require.NoError(t, db.Table("execution_targets").Where("name = ? AND deleted_at IS NULL", "concurrent-dup").Count(&count).Error)
	require.Equal(t, int64(1), count)
}

// TestExecutionTarget_SoftDeleteReusesName: soft delete 后允许重用名称
// （unique index 只覆盖 active 行）。
func TestExecutionTarget_SoftDeleteReusesName(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "et_sd1", "pass1234", "ET_SD")

	w := postAuth("/web/execution-targets", u.Token, map[string]interface{}{
		"name":        "reusable-name",
		"target_type": "local_edge",
	})
	require.Equal(t, http.StatusCreated, w.StatusCode)
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&created))
	w.Body.Close()

	// 删除。
	w = del("/web/execution-targets/"+created.Data.ID, u.Token)
	require.Equal(t, http.StatusOK, w.StatusCode)
	w.Body.Close()

	// 同名重建成功。
	w = postAuth("/web/execution-targets", u.Token, map[string]interface{}{
		"name":        "reusable-name",
		"target_type": "local_edge",
	})
	require.Equal(t, http.StatusCreated, w.StatusCode, "soft-deleted name must be reusable")
	w.Body.Close()
}

// TestExecutionTarget_DBRejectsInvalidState: 绕过 service 直接写库时，
// CHECK 约束拒绝非法枚举与越界 port（双层防御的 DB 侧）。
func TestExecutionTarget_DBRejectsInvalidState(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "et_dbi1", "pass1234", "ET_DBI")

	for name, stmt := range map[string]string{
		"invalid type": fmt.Sprintf(
			"INSERT INTO execution_targets (owner_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata) VALUES ('%s', 'bad-type', 'teleporter', '[]', 'local', 'unknown', '{}', '{}')",
			u.ID),
		"invalid trust": fmt.Sprintf(
			"INSERT INTO execution_targets (owner_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata) VALUES ('%s', 'bad-trust', 'local_edge', '[]', 'superuser', 'unknown', '{}', '{}')",
			u.ID),
		"negative port": fmt.Sprintf(
			"INSERT INTO execution_targets (owner_id, name, target_type, workspace_allowlist, trust_level, health_state, port, capabilities, metadata) VALUES ('%s', 'bad-port', 'remote_ssh', '[]', 'remote', 'unknown', -1, '{}', '{}')",
			u.ID),
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, db.Exec(stmt).Error, "DB must reject %s", name)
		})
	}
}

// TestExecutionTarget_PatchThreeStateOverAPI: HTTP PATCH 的三态语义
// （omitted/set/null）端到端验证：port 重置为 0、device_id 解绑、host 清空。
func TestExecutionTarget_PatchThreeStateOverAPI(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "et_p3s1", "pass1234", "ET_P3S")

	w := postAuth("/web/execution-targets", u.Token, map[string]interface{}{
		"name":        "patch-me",
		"target_type": "remote_ssh",
		"host":        "10.1.2.3",
		"port":        2222,
	})
	require.Equal(t, http.StatusCreated, w.StatusCode)
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&created))
	w.Body.Close()

	// port → 0（旧语义无法表达"重置为默认"）。
	w = patchAuth("/web/execution-targets/"+created.Data.ID, u.Token, map[string]interface{}{
		"port": 0,
	})
	require.Equal(t, http.StatusOK, w.StatusCode)
	var updated struct {
		Data struct {
			Port int `json:"port"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&updated))
	w.Body.Close()
	require.Equal(t, 0, updated.Data.Port, "port must be resettable to 0")

	// host → null on a host-required type must be rejected by the
	// combination constraint (remote_ssh requires a host, #1545).
	w = patchAuth("/web/execution-targets/"+created.Data.ID, u.Token, map[string]any{
		"host": nil,
	})
	require.Equal(t, http.StatusBadRequest, w.StatusCode, "remote_ssh host cannot be cleared (combination constraint)")
	w.Body.Close()

	// host 清空只对允许无 host 的类型有意义：seed 一个带 host 的 local_edge
	//（#1544 前的历史数据形态），patch null 后 host 被清空。
	var legacyID string
	require.NoError(t, db.Raw(
		"INSERT INTO execution_targets (owner_id, name, target_type, host, workspace_allowlist, trust_level, health_state, capabilities, metadata) VALUES (?, ?, 'local_edge', '10.9.9.9', '[]', 'local', 'unknown', '{}', '{}') RETURNING id",
		u.ID, "legacy-local-edge").Scan(&legacyID).Error)
	w = patchAuth("/web/execution-targets/"+legacyID, u.Token, map[string]any{
		"host": nil,
	})
	require.Equal(t, http.StatusOK, w.StatusCode)
	var cleared struct {
		Data struct {
			Host string `json:"host"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&cleared))
	w.Body.Close()
	require.Equal(t, "", cleared.Data.Host, "host must be clearable via null")

	// health_state 必须被显式拒绝（system-managed）。
	w = patchAuth("/web/execution-targets/"+created.Data.ID, u.Token, map[string]interface{}{
		"health_state": "online",
	})
	require.Equal(t, http.StatusBadRequest, w.StatusCode, "health_state must be rejected")
	w.Body.Close()

	// target_type 固定创建期，patch 必须拒绝。
	w = patchAuth("/web/execution-targets/"+created.Data.ID, u.Token, map[string]interface{}{
		"target_type": "local_edge",
	})
	require.Equal(t, http.StatusBadRequest, w.StatusCode, "target_type must be rejected")
	w.Body.Close()
}
