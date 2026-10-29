package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service/edgedevice"
	"github.com/agenthub/hub-server/internal/service/edgeenrollment"
	"github.com/gin-gonic/gin"
)

type EdgeEnrollmentService interface {
	Start(context.Context, edgeenrollment.StartInput) (*edgeenrollment.StartResult, error)
	Preview(context.Context, string) (*edgeenrollment.EnrollmentSummary, error)
	Confirm(context.Context, edgeenrollment.Authorizer, string) (*edgeenrollment.EnrollmentSummary, error)
	Exchange(context.Context, string, string) (*edgeenrollment.ExchangeResult, error)
	Authenticate(context.Context, string) (*edgeenrollment.Principal, error)
	Heartbeat(context.Context, *edgeenrollment.Principal) error
	Revoke(context.Context, string, string) error
}

type EdgeDeviceChannel interface {
	Poll(context.Context, *edgeenrollment.Principal) (*edgedevice.PollResult, error)
	AuthorizeTask(context.Context, *edgeenrollment.Principal, string) error
	AckControl(context.Context, *edgeenrollment.Principal, string, edgedevice.ControlAck) error
}

// EdgeEnrollmentHandler deliberately separates product-session confirmation
// from the opaque device channel. The existing AgentHandler owns callbacks.
type EdgeEnrollmentHandler struct {
	enrollment EdgeEnrollmentService
	channel    EdgeDeviceChannel
	clientID   string
}

func NewEdgeEnrollmentHandler(enrollment EdgeEnrollmentService, channel EdgeDeviceChannel, currentClientID string) *EdgeEnrollmentHandler {
	return &EdgeEnrollmentHandler{enrollment: enrollment, channel: channel, clientID: currentClientID}
}

func edgeBody(c *gin.Context, value any) bool {
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(value) != nil || decoder.Decode(new(any)) != io.EOF {
		Fail(c, errcode.ErrBadRequest)
		return false
	}
	return true
}

func edgeFailure(c *gin.Context, err error) {
	var coded *errcode.Error
	if errors.As(err, &coded) {
		Fail(c, coded)
	} else {
		// Database/transport errors can contain credentials or internal paths.
		Fail(c, errcode.AuthUnavailable)
	}
}

func (h *EdgeEnrollmentHandler) Start(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var input edgeenrollment.StartInput
	if !edgeBody(c, &input) {
		return
	}
	result, err := h.enrollment.Start(c.Request.Context(), input)
	if err != nil {
		edgeFailure(c, err)
		return
	}
	OK(c, result)
}

func (h *EdgeEnrollmentHandler) Preview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	result, err := h.enrollment.Preview(c.Request.Context(), c.Param("code"))
	if err != nil {
		edgeFailure(c, err)
		return
	}
	OK(c, result)
}

func (h *EdgeEnrollmentHandler) Confirm(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var input struct {
		UserCode string `json:"user_code"`
	}
	if !edgeBody(c, &input) {
		return
	}
	// Both browser and native middleware attach a durable validator after
	// checking the current OIDC client. Never infer generation zero when no
	// identity-bound session was authenticated.
	generationValue, present := c.Get("session_generation")
	generation, validGeneration := generationValue.(int64)
	validatorValue, _ := c.Get("session_validator")
	validator, validValidator := validatorValue.(func(context.Context) error)
	if !present || !validGeneration || !validValidator || c.GetString("session_identity_id") == "" || h.clientID == "" {
		Fail(c, errcode.AuthInvalidToken)
		return
	}
	if err := validator(c.Request.Context()); err != nil {
		edgeFailure(c, err)
		return
	}
	auth := edgeenrollment.Authorizer{UserID: c.GetString("user_id"), IdentityID: c.GetString("session_identity_id"), Generation: generation, OIDCClientID: h.clientID}
	result, err := h.enrollment.Confirm(c.Request.Context(), auth, input.UserCode)
	if err != nil {
		edgeFailure(c, err)
		return
	}
	OK(c, result)
}

func (h *EdgeEnrollmentHandler) Exchange(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var input struct {
		EnrollmentID string `json:"enrollment_id"`
		PollSecret   string `json:"poll_secret"`
	}
	if !edgeBody(c, &input) {
		return
	}
	result, err := h.enrollment.Exchange(c.Request.Context(), input.EnrollmentID, input.PollSecret)
	if err != nil {
		edgeFailure(c, err)
		return
	}
	if result.Status == "pending" {
		c.JSON(http.StatusAccepted, Response{Code: errcode.OK.Code, Data: result})
		return
	}
	OK(c, result)
}

func (h *EdgeEnrollmentHandler) Revoke(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if err := h.enrollment.Revoke(c.Request.Context(), c.GetString("user_id"), c.Param("device_id")); err != nil {
		edgeFailure(c, err)
		return
	}
	OK(c, gin.H{"revoked": true})
}

// DeviceAuth is only installed on /edge/device/*. No browser cookie, Hub
// session JWT, query credential or Edge API JWT can authenticate this channel.
func (h *EdgeEnrollmentHandler) DeviceAuth(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	values := c.Request.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
		Fail(c, errcode.AuthInvalidToken)
		return
	}
	query := c.Request.URL.Query()
	for _, key := range []string{"access_token", "token", "credential"} {
		if _, found := query[key]; found {
			Fail(c, errcode.AuthInvalidToken)
			return
		}
	}
	principal, err := h.enrollment.Authenticate(c.Request.Context(), strings.TrimPrefix(values[0], "Bearer "))
	if err != nil {
		edgeFailure(c, err)
		return
	}
	c.Set("edge_device_principal", principal)
	c.Set("user_id", principal.UserID)
	c.Set("device_id", principal.DeviceID)
	c.Next()
}

func edgePrincipal(c *gin.Context) *edgeenrollment.Principal {
	value, _ := c.Get("edge_device_principal")
	p, _ := value.(*edgeenrollment.Principal)
	return p
}

func (h *EdgeEnrollmentHandler) Heartbeat(c *gin.Context) {
	p := edgePrincipal(c)
	if p == nil {
		Fail(c, errcode.AuthInvalidToken)
		return
	}
	if err := h.enrollment.Heartbeat(c.Request.Context(), p); err != nil {
		edgeFailure(c, err)
		return
	}
	OK(c, gin.H{"expires_at": p.ExpiresAt})
}

func (h *EdgeEnrollmentHandler) Poll(c *gin.Context) {
	waitSeconds := 20
	if values, found := c.Request.URL.Query()["wait_seconds"]; found {
		var err error
		if len(values) != 1 {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		waitSeconds, err = strconv.Atoi(values[0])
		if err != nil || waitSeconds < 0 || waitSeconds > 20 {
			Fail(c, errcode.ErrBadRequest)
			return
		}
	}
	p := edgePrincipal(c)
	if p == nil {
		Fail(c, errcode.AuthInvalidToken)
		return
	}
	deadline := time.NewTimer(time.Duration(waitSeconds) * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		result, err := h.channel.Poll(c.Request.Context(), p)
		if err != nil {
			edgeFailure(c, err)
			return
		}
		if len(result.Deliveries) > 0 || len(result.Controls) > 0 || waitSeconds == 0 {
			OK(c, result)
			return
		}
		select {
		case <-c.Request.Context().Done():
			return
		case <-deadline.C:
			// One last durable validation prevents an empty successful response
			// from hiding revocation that happened during the final wait.
			result, err = h.channel.Poll(c.Request.Context(), p)
			if err != nil {
				edgeFailure(c, err)
				return
			}
			OK(c, result)
			return
		case <-ticker.C:
		}
	}
}

func (h *EdgeEnrollmentHandler) TaskAuthorization(c *gin.Context) {
	id, ok := taskIDParam(c)
	if !ok {
		return
	}
	if err := h.channel.AuthorizeTask(c.Request.Context(), edgePrincipal(c), id); err != nil {
		edgeFailure(c, err)
		return
	}
	c.Next()
}

func (h *EdgeEnrollmentHandler) AckControl(c *gin.Context) {
	var input edgedevice.ControlAck
	if !edgeBody(c, &input) {
		return
	}
	if err := h.channel.AckControl(c.Request.Context(), edgePrincipal(c), c.Param("control_id"), input); err != nil {
		edgeFailure(c, err)
		return
	}
	OK(c, nil)
}
