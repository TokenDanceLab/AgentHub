package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/service/agentprofile"
	"github.com/agenthub/hub-server/internal/service/executiontarget"
	"github.com/agenthub/hub-server/internal/service/message"
	"github.com/agenthub/hub-server/internal/service/session"
	"github.com/agenthub/hub-server/internal/service/workspace"
)

// Page-size ceilings, per endpoint — external-test half (#2243).
//
// paging_ceiling_test.go (package handler) carries the reasoning and the cases
// whose service mocks are internal; this file covers the endpoints whose mocks
// live in package handler_test. The invariant is the same: the page size a
// handler forwards is the page size its query executes, and it is the bound
// api/openapi.yaml declares for that endpoint.
//
// The session-search case is the sharpest one. repository.SearchSessions turns
// pageSize straight into `LIMIT pageSize+1` and clamps nothing, so before #2243
// the handler's MaxPageLimit ceiling was the endpoint's only bound: it served up
// to 500 rows while its openapi parameter (the shared PageSize) declares
// maximum: 200.

// notForwardedExt is reported when a handler never reached its service.
const notForwardedExt = -1

type pagingCeilingCaseExt struct {
	name       string
	enforcedBy string
	route      string
	base       string
	param      string
	ceiling    int
	absent     int
	zero       int
	negStatus  int
	// unparsableStatus (when non-zero) marks an endpoint that rejects an
	// unparsable page-size parameter with that status instead of swallowing it
	// into the default. The message endpoints parse `limit` themselves and answer
	// 400; the DefaultQuery-based endpoints let strconv fail into 0 and then take
	// the default branch. Both shapes are legitimate, but only one of them can be
	// asserted by a single expectation, so the difference is declared per case
	// rather than discovered by a reader (#2243).
	unparsableStatus int
	forward          func(t *testing.T, target string) (int, int)
}

func servePagingExt(t *testing.T, route string, h func(*gin.Context), target string) int {
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

func pagingTargetExt(base, param, value string) string {
	if value == "" {
		return base
	}
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
	}
	return base + sep + param + "=" + value
}

func externalPagingCeilingCases() []pagingCeilingCaseExt {
	return []pagingCeilingCaseExt{
		{
			name:       "GET /web/projects",
			enforcedBy: "repository.ListWorkspaces → ClampPageSize(.., MaxListPageSize, defaultWorkspacePageSize)",
			route:      "/web/projects",
			base:       "/web/projects",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwardedExt
				h := handler.NewWorkspaceHandler(&mockWorkspaceService{
					listFn: func(_ context.Context, _, _, _ string, pageSize int) (*workspace.WorkspaceListResult, error) {
						got = pageSize
						return &workspace.WorkspaceListResult{}, nil
					},
				})
				status := servePagingExt(t, "/web/projects", h.ListWorkspaces, target)
				return got, status
			},
		},
		{
			name:       "GET /web/projects/{id}/threads/{threadId}/messages",
			enforcedBy: "workspace.Service.ListThreadMessages → ClampPageSize(.., MaxMessagePageLimit, ..) before repository.GetMessagesBySession (same ceiling); openapi limit maximum: 100",
			route:      "/web/projects/:id/threads/:threadId/messages",
			base:       "/web/projects/project-paging/threads/thread-paging/messages",
			param:      "limit",
			ceiling:    config.MaxMessagePageLimit,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwardedExt
				h := handler.NewWorkspaceHandler(&mockWorkspaceService{
					listThreadMessagesFn: func(_ context.Context, _, _, _ string, limit int) ([]workspace.WorkspaceThreadMessage, error) {
						got = limit
						return nil, nil
					},
				})
				status := servePagingExt(t, "/web/projects/:id/threads/:threadId/messages", h.ListProjectThreadMessages, target)
				return got, status
			},
		},
		{
			name:       "GET /web/agent-profiles",
			enforcedBy: "repository.ListAgentProfiles → ClampPageSize(.., MaxListPageSize, defaultProfilePageSize)",
			route:      "/web/agent-profiles",
			base:       "/web/agent-profiles",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwardedExt
				h := handler.NewAgentProfileHandler(&mockAgentProfileService{
					listFn: func(_ context.Context, _, _, _, _ string, pageSize int) (*agentprofile.ListResult, error) {
						got = pageSize
						return &agentprofile.ListResult{}, nil
					},
				})
				status := servePagingExt(t, "/web/agent-profiles", h.ListProfiles, target)
				return got, status
			},
		},
		{
			name:       "GET /web/execution-targets",
			enforcedBy: "repository.ListExecutionTargets → ClampPageSize(.., MaxListPageSize, defaultTargetPageSize)",
			route:      "/web/execution-targets",
			base:       "/web/execution-targets",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwardedExt
				h := handler.NewExecutionTargetHandler(&mockExecutionTargetService{
					list: func(_ context.Context, _, _, _ string, pageSize int) (*executiontarget.ListResult, error) {
						got = pageSize
						return &executiontarget.ListResult{}, nil
					},
				})
				status := servePagingExt(t, "/web/execution-targets", h.ListTargets, target)
				return got, status
			},
		},
		{
			name:       "GET /client/sessions/search",
			enforcedBy: "repository.SearchSessions → no ceiling of its own (`LIMIT pageSize+1`), so this handler is the enforcement point for the shared PageSize maximum: 200",
			route:      "/client/sessions/search",
			base:       "/client/sessions/search?q=paging",
			param:      "pageSize",
			ceiling:    config.MaxListPageSize,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwardedExt
				h := handler.NewSessionHandler(&mockSessionService{
					searchFn: func(_ context.Context, _, _, _ string, pageSize int) (*session.SessionSearchPage, error) {
						got = pageSize
						return &session.SessionSearchPage{Items: []session.SessionListItem{{SessionID: "s-paging"}}}, nil
					},
				})
				status := servePagingExt(t, "/client/sessions/search", h.SearchSessions, target)
				return got, status
			},
		},
		{
			// The #2243 tail: these three were the last hand-written two-branch
			// clamps in internal/handler. Their values do not move — 100 / 500 /
			// 100 — only the shape converges on ClampPageSize, so the ceiling each
			// endpoint enforces is now stated in exactly one idiom.
			name:       "GET /client/sessions/{id}/messages",
			enforcedBy: "repository.GetMessagesBySession → ClampPageSize(.., MaxMessagePageLimit, DefaultPaginationLimit): same value, same default",
			route:      "/client/sessions/:id/messages",
			base:       "/client/sessions/session-paging/messages",
			param:      "limit",
			ceiling:    config.MaxMessagePageLimit,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			// This handler parses `limit` itself and answers 400 on a non-numeric
			// value rather than falling back to the default.
			unparsableStatus: http.StatusBadRequest,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwardedExt
				h := handler.NewMessageHandler(&mockMessageService{
					getMsgsFn: func(_ context.Context, _, _ string, _ int64, limit int) ([]message.MessageResponse, error) {
						got = limit
						return nil, nil
					},
				})
				status := servePagingExt(t, "/client/sessions/:id/messages", h.GetMessages, target)
				return got, status
			},
		},
		{
			name:             "GET /client/sessions/{id}/messages/sync",
			enforcedBy:       "repository.GetMessagesIncrement → `limit <= 0 || limit > MaxIncrementalMessageLimit → 500`; this handler never forwards a non-positive value, so the 500-for-non-positive branch is unreachable from here",
			route:            "/client/sessions/:id/messages/sync",
			base:             "/client/sessions/session-paging/messages/sync",
			param:            "limit",
			ceiling:          config.MaxIncrementalMessageLimit,
			absent:           config.DefaultPaginationLimit,
			zero:             config.DefaultPaginationLimit,
			unparsableStatus: http.StatusBadRequest,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwardedExt
				h := handler.NewMessageHandler(&mockMessageService{
					getMsgsIncrFn: func(_ context.Context, _, _ string, _ int64, limit int) ([]message.MessageResponse, error) {
						got = limit
						return nil, nil
					},
				})
				status := servePagingExt(t, "/client/sessions/:id/messages/sync", h.GetIncrementalMessages, target)
				return got, status
			},
		},
		{
			name:       "GET /client/messages/search",
			enforcedBy: "no ceiling in either search query (repository/message.go: \"pageSize is clamped by the caller\") — this handler is the enforcement point, deliberately held at MaxMessagePageLimit, which is stricter than the shared PageSize maximum: 200 these routes reference",
			route:      "/client/messages/search",
			base:       "/client/messages/search?q=paging",
			param:      "pageSize",
			ceiling:    config.MaxMessagePageLimit,
			absent:     config.DefaultPaginationLimit,
			zero:       config.DefaultPaginationLimit,
			forward: func(t *testing.T, target string) (int, int) {
				got := notForwardedExt
				h := handler.NewMessageHandler(&mockMessageService{
					searchFn: func(_ context.Context, _, _, _, _, _, _ string, _ string, pageSize int) (*message.MessageSearchPage, error) {
						got = pageSize
						return &message.MessageSearchPage{}, nil
					},
				})
				status := servePagingExt(t, "/client/messages/search", h.SearchMessages, target)
				return got, status
			},
		},
	}
}

// TestHandlerPageSizeCeilingExt_OverCeilingClampsToWhatTheQueryExecutes mirrors
// the internal-package pin for the endpoints mocked from outside the package:
// pageSize=300 must be forwarded as 200 (or 100 for the thread-message list)
// instead of travelling to a layer that shortens it silently.
func TestHandlerPageSizeCeilingExt_OverCeilingClampsToWhatTheQueryExecutes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, tc := range externalPagingCeilingCases() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			over := tc.ceiling + 100
			got, status := tc.forward(t, pagingTargetExt(tc.base, tc.param, strconv.Itoa(over)))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.ceiling, got,
				"%s=%d must clamp to the ceiling %s enforces (%d)", tc.param, over, tc.enforcedBy, tc.ceiling)

			want300 := 300
			if tc.ceiling < 300 {
				want300 = tc.ceiling
			}
			got, status = tc.forward(t, pagingTargetExt(tc.base, tc.param, "300"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, want300, got, "%s=300 on %s", tc.param, tc.name)
		})
	}
}

// TestHandlerPageSizeCeilingExt_InRangeAndNonPositive guards the remaining two
// ClampPageSize branches at these handler boundaries.
func TestHandlerPageSizeCeilingExt_InRangeAndNonPositive(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, tc := range externalPagingCeilingCases() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got, status := tc.forward(t, pagingTargetExt(tc.base, tc.param, "30"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, 30, got, "an in-range %s must be forwarded unchanged", tc.param)

			got, status = tc.forward(t, tc.base)
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.absent, got, "a missing %s must forward the endpoint default", tc.param)

			got, status = tc.forward(t, pagingTargetExt(tc.base, tc.param, "0"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.zero, got, "%s=0 must forward the endpoint default", tc.param)

			if tc.negStatus != 0 {
				got, status = tc.forward(t, pagingTargetExt(tc.base, tc.param, "-5"))
				require.Equal(t, tc.negStatus, status, "%s=-5 must be rejected", tc.param)
				require.Equal(t, notForwardedExt, got, "a rejected request must not reach the service")
				return
			}
			got, status = tc.forward(t, pagingTargetExt(tc.base, tc.param, "-5"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.zero, got, "%s=-5 must forward the endpoint default", tc.param)
		})
	}
}

// TestHandlerPageSizeCeilingExt_UnparsablePageSizeKeepsDefault pins the branch
// strconv.Atoi swallows: `pageSize=abc` must forward the default, not 0 (which
// the queries below would read as "no limit" or as a non-positive sentinel).
func TestHandlerPageSizeCeilingExt_UnparsablePageSizeKeepsDefault(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, tc := range externalPagingCeilingCases() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if tc.unparsableStatus != 0 {
				got, status := tc.forward(t, pagingTargetExt(tc.base, tc.param, "not-a-number"))
				require.Equal(t, tc.unparsableStatus, status,
					"an unparsable %s must be rejected by an endpoint that parses it itself", tc.param)
				require.Equal(t, notForwardedExt, got, "a rejected request must not reach the service")
				return
			}
			got, status := tc.forward(t, pagingTargetExt(tc.base, tc.param, "not-a-number"))
			require.Equal(t, http.StatusOK, status)
			require.Equal(t, tc.zero, got, "an unparsable %s must forward the endpoint default", tc.param)
		})
	}
}
