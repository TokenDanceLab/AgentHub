package router

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/service/edgedevice"
	"github.com/agenthub/hub-server/internal/service/edgeenrollment"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type deadlineEnrollment struct {
	handler.EdgeEnrollmentService
	remaining time.Duration
}

func (*deadlineEnrollment) Authenticate(context.Context, string) (*edgeenrollment.Principal, error) {
	return &edgeenrollment.Principal{UserID: "fixture-user", DeviceID: "fixture-device"}, nil
}

func (s *deadlineEnrollment) Heartbeat(ctx context.Context, _ *edgeenrollment.Principal) error {
	deadline, _ := ctx.Deadline()
	s.remaining = time.Until(deadline)
	return nil
}

type deadlineChannel struct {
	handler.EdgeDeviceChannel
	remaining time.Duration
}

func (s *deadlineChannel) Poll(ctx context.Context, _ *edgeenrollment.Principal) (*edgedevice.PollResult, error) {
	deadline, _ := ctx.Deadline()
	s.remaining = time.Until(deadline)
	return &edgedevice.PollResult{Deliveries: []edgedevice.Delivery{}, Controls: []edgedevice.Control{}}, nil
}

func TestPairedPollCanOutliveOrdinaryRequestDeadline(t *testing.T) {
	gin.SetMode(gin.TestMode)
	enrollment, channel := &deadlineEnrollment{}, &deadlineChannel{}
	h := handler.NewEdgeEnrollmentHandler(enrollment, channel, "fixture-client")
	auth := middleware.NewAuthMiddleware(&config.Config{}, middleware.AuthDependencies{})
	r := gin.New()
	setupPairedEdgeRoutes(r, auth, nil, h, &handler.AgentHandler{})
	for _, request := range []struct{ method, path string }{
		{"GET", "/edge/device/poll?wait_seconds=0"},
		{"POST", "/edge/device/heartbeat"},
	} {
		req := httptest.NewRequest(request.method, request.path, nil)
		req.Header.Set("Authorization", "Bearer fixture-device-proof")
		response := httptest.NewRecorder()
		r.ServeHTTP(response, req)
		require.Equal(t, 200, response.Code)
	}
	// Observe the actual context passed through the registered router. A poll
	// must have time to finish its 20-second wait; heartbeat keeps the 15s guard.
	require.Greater(t, channel.remaining, 20*time.Second)
	require.LessOrEqual(t, channel.remaining, 25*time.Second)
	require.Greater(t, enrollment.remaining, 10*time.Second)
	require.LessOrEqual(t, enrollment.remaining, config.DefaultRequestTimeout)
}
