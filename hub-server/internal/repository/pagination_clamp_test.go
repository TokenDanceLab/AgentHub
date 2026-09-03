package repository

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

// Page-size clamping (#2154).
//
// Twelve list entry points in this package normalized an out-of-range page size
// with the same shape:
//
//	if pageSize <= 0 || pageSize > 200 { pageSize = defaultXPageSize }   // 50
//
// The upper branch is wrong: a request for 201 rows — which api/openapi.yaml
// permits up to 200 — silently produced a **50-row** page with HTTP 200. Two
// consequences, of different severity:
//
//   - cursor-paged lists (workspaces, skills, profiles, execution targets,
//     provider bindings, MCP servers, audit events): nextCursor is still
//     derived from the rows actually returned, so nothing is lost, but the
//     client gets a quarter of the page it asked for and needs ~4x the round
//     trips. The declared contract (PageSize maximum: 200) is not what the
//     endpoint enforces.
//   - offset-paged ListNotifications and the fixed-offset thread-message list
//     return a bare array with no cursor at all, so a short page is
//     indistinguishable from the end of the collection: the thread panel asks
//     for its ceiling and silently renders 50 with no way to reach the rest, and
//     any offset consumer that advances by the *requested* limit skips rows.
//
// When these tests were written the handler layer clamped every list to
// config.MaxPageLimit=500, so an oversized pageSize really did arrive here and
// this package's clamp was the endpoint's only bound. Since #2243 the handlers
// clamp to the same per-endpoint ceiling the query beneath them enforces —
// MaxListPageSize for the cursor-paged lists, MaxMessagePageLimit for
// notifications and the thread-message list — pinned by
// handler/paging_ceiling_test.go and handler/paging_ceiling_ext_test.go. What is
// asserted below is therefore defence in depth for callers that bypass the
// handlers, not the client-visible bound.
//
// repository/message.go:48 (GetMessagesIncrement) and
// agent_team_assignments.go:160 already had the correct shape — clamp to the
// maximum — which is the evidence that the other twelve are copy errors rather
// than a deliberate policy.
//
// These tests assert the clamp *behaviourally* (seed more rows than the
// maximum, count what comes back) rather than by reading the code, and they pin
// both directions: out-of-range-high clamps to the maximum, non-positive still
// falls back to the default, and in-range values pass through untouched.

const (
	pagingOwner      = "u-paging"
	pagingListMax    = 200 // api/openapi.yaml PageSize maximum, enforced per endpoint
	pagingMessageMax = config.MaxMessagePageLimit
	pagingListDef    = 50 // config.DefaultPaginationLimit, the per-package defaultXPageSize
)

// setupPagingDB extends the shared SQLite fixture with the list tables it does
// not create, so every clamp can be asserted by counting real rows.
func setupPagingDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupSQLite(t)
	require.NoError(t, db.AutoMigrate(
		&model.Workspace{},
		&model.Skill{},
		&model.ExecutionTarget{},
		&model.ProviderBinding{},
		&model.MCPServer{},
		&model.AuditEvent{},
	))
	return db
}

func seedN(t *testing.T, db *gorm.DB, n int, row func(i int) interface{}) {
	t.Helper()
	for i := 0; i < n; i++ {
		require.NoError(t, db.Create(row(i)).Error)
	}
}

type pagingCase struct {
	name string
	max  int
	// seed inserts max+1 visible rows.
	seed func(t *testing.T, db *gorm.DB, n int)
	// call returns the number of rows the entry point handed back, and whether
	// it reported more pages (false for the bare-array entry points).
	call    func(t *testing.T, db *gorm.DB, size int) (int, bool)
	hasMore bool
}

func pagingCases() []pagingCase {
	return []pagingCase{
		{
			name: "ListWorkspaces", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.Workspace{Name: fmt.Sprintf("ws-%03d", i), OwnerID: pagingOwner}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListWorkspaces(db, pagingOwner, "", "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListSkills", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.Skill{OwnerID: pagingOwner, Name: fmt.Sprintf("skill-%03d", i)}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListSkills(db, pagingOwner, "", "", "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListPublicSkills", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.Skill{OwnerID: pagingOwner, Name: fmt.Sprintf("pub-skill-%03d", i), IsPublic: true}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListPublicSkills(db, "", "", "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListAgentProfiles", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.AgentProfile{OwnerID: pagingOwner, Name: fmt.Sprintf("profile-%03d", i), RuntimeID: "rt-1"}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListAgentProfiles(db, pagingOwner, "", "", "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListPublicProfiles", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.AgentProfile{OwnerID: pagingOwner, Name: fmt.Sprintf("pub-profile-%03d", i), RuntimeID: "rt-1", IsPublic: true}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListPublicProfiles(db, "", "", "", "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListExecutionTargets", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.ExecutionTarget{OwnerID: pagingOwner, Name: fmt.Sprintf("target-%03d", i)}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListExecutionTargets(db, pagingOwner, "", "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListProviderBindings", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.ProviderBinding{OwnerID: pagingOwner, Provider: fmt.Sprintf("provider-%03d", i)}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListProviderBindings(db, pagingOwner, "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListMCPServers", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.MCPServer{OwnerID: pagingOwner, Name: fmt.Sprintf("mcp-%03d", i)}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListMCPServers(db, pagingOwner, "", "", "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListPublicMCPServers", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.MCPServer{OwnerID: pagingOwner, Name: fmt.Sprintf("pub-mcp-%03d", i), IsPublic: true}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListPublicMCPServers(db, "", "", "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListAuditEvents", max: pagingListMax, hasMore: true,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.AuditEvent{UserID: pagingOwner, EventType: "test.event", Severity: "info", Summary: fmt.Sprintf("s-%03d", i)}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, more, err := ListAuditEvents(db, pagingOwner, "", "", nil, nil, "", size)
				require.NoError(t, err)
				return len(list), more
			},
		},
		{
			name: "ListNotifications", max: pagingMessageMax, hasMore: false,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.Notification{UserID: pagingOwner, Type: "test", Payload: fmt.Sprintf(`{"i":%d}`, i)}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, err := ListNotifications(db, pagingOwner, false, size, 0)
				require.NoError(t, err)
				return len(list), false
			},
		},
		{
			name: "GetMessagesBySession", max: pagingMessageMax, hasMore: false,
			seed: func(t *testing.T, db *gorm.DB, n int) {
				seedN(t, db, n, func(i int) interface{} {
					return &model.Message{
						SessionID: "sess-paging", SeqID: int64(i + 1), ClientMsgID: fmt.Sprintf("cmid-%03d", i),
						SenderType: "user", SenderID: pagingOwner, ContentType: "text", Content: `{"text":"x"}`,
					}
				})
			},
			call: func(t *testing.T, db *gorm.DB, size int) (int, bool) {
				list, err := GetMessagesBySession(db, "sess-paging", 0, size)
				require.NoError(t, err)
				return len(list), false
			},
		},
	}
}

// TestListEndpoints_ClampOversizedPageSizeToMax is the regression pin: asking
// for max+1 must return max rows, not the default.
func TestListEndpoints_ClampOversizedPageSizeToMax(t *testing.T) {
	for _, tc := range pagingCases() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			db := setupPagingDB(t)
			tc.seed(t, db, tc.max+1)

			rows, more := tc.call(t, db, tc.max+1)
			require.Equal(t, tc.max, rows,
				"pageSize over the maximum must clamp to the maximum, not collapse to the %d-row default", pagingListDef)
			if tc.hasMore {
				require.True(t, more, "one row beyond the page must still be reported as hasMore")
			}
		})
	}
}

// TestListEndpoints_InRangePageSizePassesThrough guards the other direction:
// clamping must not become a new way to ignore what the client asked for.
func TestListEndpoints_InRangePageSizePassesThrough(t *testing.T) {
	for _, tc := range pagingCases() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			db := setupPagingDB(t)
			tc.seed(t, db, tc.max+1)

			rows, more := tc.call(t, db, 30)
			require.Equal(t, 30, rows, "an in-range pageSize must be honoured exactly")
			if tc.hasMore {
				require.True(t, more)
			}
		})
	}
}

// TestListEndpoints_NonPositivePageSizeKeepsDefault pins the half of the old
// behaviour that was correct, so the clamp cannot be "fixed" into returning
// everything (or nothing) for a missing/invalid pageSize.
func TestListEndpoints_NonPositivePageSizeKeepsDefault(t *testing.T) {
	for _, tc := range pagingCases() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			db := setupPagingDB(t)
			tc.seed(t, db, tc.max+1)

			for _, size := range []int{0, -5} {
				rows, _ := tc.call(t, db, size)
				require.Equal(t, pagingListDef, rows,
					"a non-positive pageSize must fall back to the default page size")
			}
		})
	}
}
