package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agentprofile"
	"github.com/agenthub/hub-server/internal/service/agentteam"
	"github.com/agenthub/hub-server/internal/service/audit"
	"github.com/agenthub/hub-server/internal/service/mcpserver"
	"github.com/agenthub/hub-server/internal/service/providerbinding"
	"github.com/agenthub/hub-server/internal/service/skill"
)

// Page-size ceilings, per endpoint (#2243).
//
// api/openapi.yaml is written against the handler layer, so the handler is where
// a declared page-size bound has to be executed. Until #2243 every list handler
// clamped to config.MaxPageLimit (500) while the query underneath clamped to 200
// or 100, so pageSize=300 produced a silently shortened page with HTTP 200: the
// client asked for 300, received 200, and got no cursor, header or error telling
// it the page had been cut. config.ClampPageSize existed to end exactly that, and
// the handler layer never called it.
//
// Each case below pins the page size one handler *forwards*, which is the page
// size its query executes, and names that query in enforcedBy so the pairing is
// readable from either side. The ceiling is per endpoint, not global:
//
//	200  MaxListPageSize      the generic cursor-paged lists (openapi's shared
//	                          PageSize parameter declares maximum: 200)
//	100  MaxMessagePageLimit  notifications and project-thread messages, whose
//	                          responses are bare arrays with no cursor
//	500  MaxPageLimit         agent-task run events and team-run events, whose own
//	                          openapi parameters declare maximum: 500 and whose
//	                          queries clamp no lower
//
// Lowering the 500 pair would serve fewer rows than their contract promises; the
// desktop client really does ask for limit=500 on
// /web/agent-tasks/{id}/events (app/shared/src/hub/hubClientPayloadUtils.ts).
//
// The external-test companion (paging_ceiling_ext_test.go) covers the endpoints
// whose service mocks live in package handler_test.

// notForwarded is the sentinel a case reports when the handler must reject the
// request instead of calling its service.
const notForwarded = -1

type pagingCeilingCase struct {
	name string
	// enforcedBy names the lower layer that executes the same ceiling.
	enforcedBy string
	// route is the gin route pattern; base is the request target without the
	// page-size parameter (it may already carry other query parameters).
	route string
	base  string
	param string
	// ceiling is the page size the handler must forward for an over-ceiling
	// request.
	ceiling int
	// absent / zero are what a missing or non-positive parameter must forward,
	// and negStatus (when non-zero) marks a parameter the handler must reject
	// with that status instead of forwarding anything.
	absent    int
	zero      int
	negStatus int
	// forward serves one request and reports the page size the handler handed to
	// its service plus the HTTP status.
	forward func(t *testing.T, target string) (int, int)
}

func servePaging(t *testing.T, route string, h func(*gin.Context), target string) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET(route, func(c *gin.Context) {
		c.Set("user_id", "user-paging")
		h(c)
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))
	return w.Code
}

func pagingTarget(base, param, value string) string {
	if value == "" {
		return base
	}
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
	}
	return base + sep + param + "=" + value
}

func internalPagingCeilingCases() []pagingCeilingCase {
	return []pagingCeilingCase{
		{
			name:       "GET /web/skills",
			enforcedBy: "repository.ListSkills → ClampPageSize(.., MaxListPageSize, defaultSkillPageSize)",
			route:      "/web/skills",
			base:       "/web/skills",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewSkillHandler(&mockSkillService{
					list: func(_ context.Context, _, _, _, _ string, pageSize int) (*skill.ListResult, error) {
						got = pageSize
						return &skill.ListResult{}, nil
					},
				})
				status := servePaging(t, "/web/skills", h.ListSkills, target)
				return got, status
			},
		},
		{
			name:       "GET /web/skills?is_public=true",
			enforcedBy: "repository.ListPublicSkills → ClampPageSize(.., MaxListPageSize, defaultSkillPageSize)",
			route:      "/web/skills",
			base:       "/web/skills?is_public=true",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewSkillHandler(&mockSkillService{
					searchPublic: func(_ context.Context, _, _, _ string, pageSize int) (*skill.ListResult, error) {
						got = pageSize
						return &skill.ListResult{}, nil
					},
				})
				status := servePaging(t, "/web/skills", h.ListSkills, target)
				return got, status
			},
		},
		{
			name:       "GET /web/mcp-servers",
			enforcedBy: "repository.ListMCPServers → ClampPageSize(.., MaxListPageSize, defaultMCPServerPageSize)",
			route:      "/web/mcp-servers",
			base:       "/web/mcp-servers",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewMCPServerHandler(&mockMCPService{
					list: func(_ context.Context, _, _, _, _ string, pageSize int) (*mcpserver.ListResult, error) {
						got = pageSize
						return &mcpserver.ListResult{}, nil
					},
				})
				status := servePaging(t, "/web/mcp-servers", h.ListMCPServers, target)
				return got, status
			},
		},
		{
			name:       "GET /web/mcp-servers?is_public=true",
			enforcedBy: "repository.ListPublicMCPServers → ClampPageSize(.., MaxListPageSize, defaultMCPServerPageSize)",
			route:      "/web/mcp-servers",
			base:       "/web/mcp-servers?is_public=true",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewMCPServerHandler(&mockMCPService{
					searchPublic: func(_ context.Context, _, _, _ string, pageSize int) (*mcpserver.ListResult, error) {
						got = pageSize
						return &mcpserver.ListResult{}, nil
					},
				})
				status := servePaging(t, "/web/mcp-servers", h.ListMCPServers, target)
				return got, status
			},
		},
		{
			name:       "GET /web/market/profiles",
			enforcedBy: "repository.ListPublicProfiles → ClampPageSize(.., MaxListPageSize, defaultProfilePageSize)",
			route:      "/web/market/profiles",
			base:       "/web/market/profiles",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewMarketHandler(&mockMarketService{
					searchMarket: func(_ context.Context, _, _, _, _ string, pageSize int) (*agentprofile.ListResult, error) {
						got = pageSize
						return &agentprofile.ListResult{}, nil
					},
				})
				status := servePaging(t, "/web/market/profiles", h.SearchMarketProfiles, target)
				return got, status
			},
		},
		{
			name:       "GET /web/provider-bindings",
			enforcedBy: "repository.ListProviderBindings → ClampPageSize(.., MaxListPageSize, defaultProviderBindingPageSize)",
			route:      "/web/provider-bindings",
			base:       "/web/provider-bindings",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewProviderBindingHandler(&mockProviderBindingService{
					list: func(_ context.Context, _, _ string, pageSize int) (*providerbinding.ListResult, error) {
						got = pageSize
						return &providerbinding.ListResult{}, nil
					},
				})
				status := servePaging(t, "/web/provider-bindings", h.List, target)
				return got, status
			},
		},
		{
			name:       "GET /client/notifications",
			enforcedBy: "repository.ListNotifications → ClampPageSize(.., MaxMessagePageLimit, DefaultPaginationLimit)",
			route:      "/client/notifications",
			base:       "/client/notifications",
			param:      "limit",
			ceiling:    config.MaxMessagePageLimit,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewNotificationHandler(&mockNotificationService{
					listNotifications: func(_ context.Context, _ string, _ bool, limit, _ int) ([]model.Notification, error) {
						got = limit
						return nil, nil
					},
				})
				status := servePaging(t, "/client/notifications", h.ListNotifications, target)
				return got, status
			},
		},
		{
			// The 500 pair: their own openapi parameters declare maximum: 500 and
			// the queries below clamp no lower, so the handler is the enforcement
			// point and MaxPageLimit is the correct ceiling.
			name:       "GET /web/agent-tasks/{id}/events",
			enforcedBy: "repository.ListAgentRunEventsByTaskIDFiltered → no ceiling on an explicit limit (limit=0 falls back to maxAgentEventsPerQuery); openapi limit maximum: 500",
			route:      "/web/agent-tasks/:id/events",
			base:       "/web/agent-tasks/task-paging/events",
			param:      "limit",
			ceiling:    config.MaxPageLimit,
			absent:     0, // parameter absent → filter.Limit stays the zero sentinel
			zero:       0, // limit=0 means "no explicit limit", not "50 rows"
			negStatus:  http.StatusBadRequest,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewAgentHandler(&mockAgentService{
					listTaskRunEvents: func(_ context.Context, _, _ string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
						got = filter.Limit
						return nil, nil
					},
				})
				status := servePaging(t, "/web/agent-tasks/:id/events", h.TaskEvents, target)
				return got, status
			},
		},
		{
			name:       "GET /web/agent-teams/{id}/runs/{run_id}/events",
			enforcedBy: "repository.ListTeamEventsByRunPage → caps at maxTeamEventsPerRun (10000); openapi pageSize maximum: 500",
			route:      "/web/agent-teams/:id/runs/:run_id/events",
			base:       "/web/agent-teams/team-paging/runs/run-paging/events",
			param:      "pageSize",
			ceiling:    config.MaxPageLimit,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewAgentTeamHandler(&mockAgentTeamService{
					listTeamEvents: func(_ context.Context, _, _, _ string, _, limit int) (agentteam.TeamEventsPage, error) {
						got = limit
						return agentteam.TeamEventsPage{}, nil
					},
				})
				status := servePaging(t, "/web/agent-teams/:id/runs/:run_id/events", h.ListTeamEvents, target)
				return got, status
			},
		},
		{
			// The tail of #2243: audit-events was the one list handler carrying no
			// clamp at all — it forwarded the raw pageSize and
			// repository.ListAuditEvents was the endpoint's only enforcement point,
			// i.e. the page was shortened a layer below the contract that describes
			// it. defaultAuditPageSize and DefaultPaginationLimit are both 50, so
			// converging it changes no observable behaviour.
			name:       "GET /web/audit-events",
			enforcedBy: "repository.ListAuditEvents → ClampPageSize(.., MaxListPageSize, defaultAuditPageSize=50); openapi shared PageSize maximum: 200",
			route:      "/web/audit-events",
			base:       "/web/audit-events",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwarded
				h := NewAuditHandler(&mockAuditService{
					queryFn: func(_ context.Context, _ string, _ bool, _, _ string, _, _ *time.Time, _ string, pageSize int) (*audit.ListResult, error) {
						got = pageSize
						return &audit.ListResult{}, nil
					},
				})
				status := servePaging(t, "/web/audit-events", h.ListAuditEvents, target)
				return got, status
			},
		},
	}
}

// TestHandlerPageSizeCeiling_OverCeilingClampsToWhatTheQueryExecutes is the
// #2243 regression pin: an over-ceiling page size must be clamped to the ceiling
// the endpoint's own query enforces — 300 becomes 200 on a 200 endpoint (before
// this change the handler forwarded 300 and the repository quietly returned 200),
// and a 500 endpoint still forwards up to 500.
func TestHandlerPageSizeCeiling_OverCeilingClampsToWhatTheQueryExecutes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, tc := range internalPagingCeilingCases() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			over := tc.ceiling + 100
			got, status := tc.forward(t, pagingTarget(tc.base, tc.param, strconv.Itoa(over)))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.ceiling, got,
				"%s=%d must clamp to the ceiling %s enforces (%d), not pass through to be shortened below the handler",
				tc.param, over, tc.enforcedBy, tc.ceiling)

			// 300 is the value the issue is written about: on a 200 endpoint it
			// must now come back as 200, on a 500 endpoint it is in range and must
			// still be honoured exactly.
			want300 := 300
			if tc.ceiling < 300 {
				want300 = tc.ceiling
			}
			got, status = tc.forward(t, pagingTarget(tc.base, tc.param, "300"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, want300, got, "%s=300 on %s", tc.param, tc.name)
		})
	}
}

// TestHandlerPageSizeCeiling_InRangeAndNonPositive guards the other two branches
// of ClampPageSize at the handler boundary: an in-range value is honoured
// exactly, and a missing or non-positive value falls back to the default rather
// than to "everything" or "nothing".
func TestHandlerPageSizeCeiling_InRangeAndNonPositive(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, tc := range internalPagingCeilingCases() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got, status := tc.forward(t, pagingTarget(tc.base, tc.param, "30"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, 30, got, "an in-range %s must be forwarded unchanged", tc.param)

			got, status = tc.forward(t, tc.base)
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.absent, got, "a missing %s must forward the endpoint default", tc.param)

			got, status = tc.forward(t, pagingTarget(tc.base, tc.param, "0"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.zero, got, "%s=0 must forward the endpoint default", tc.param)

			if tc.negStatus != 0 {
				got, status = tc.forward(t, pagingTarget(tc.base, tc.param, "-5"))
				require.Equal(t, tc.negStatus, status, "%s=-5 must be rejected", tc.param)
				require.Equal(t, notForwarded, got, "a rejected request must not reach the service")
				return
			}
			got, status = tc.forward(t, pagingTarget(tc.base, tc.param, "-5"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.zero, got, "%s=-5 must forward the endpoint default", tc.param)
		})
	}
}

// TestHandlerPageSizeCeiling_UnparsablePageSizeKeepsDefault pins the branch
// strconv.Atoi swallows: `pageSize=abc` must forward the default rather than 0,
// which the queries below would read as a non-positive sentinel.
func TestHandlerPageSizeCeiling_UnparsablePageSizeKeepsDefault(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, tc := range internalPagingCeilingCases() {
		tc := tc
		if tc.negStatus != 0 {
			// This endpoint rejects a malformed number outright (400), which
			// TestAgentHandler_TaskEvents already pins.
			continue
		}
		t.Run(tc.name, func(t *testing.T) {
			got, status := tc.forward(t, pagingTarget(tc.base, tc.param, "not-a-number"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.zero, got, "an unparsable %s must forward the endpoint default", tc.param)
		})
	}
}
