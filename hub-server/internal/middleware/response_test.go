package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// errorResp mirrors the unified error envelope for test assertions.
type errorResp struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		TraceID string `json:"traceId"`
	} `json:"error"`
}

func TestFailHelper_ResponseFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)

	fail(c, errcode.ErrBadRequest)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusBadRequest, w.Code)

	var resp errorResp
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.Equal(t, "bad_request", resp.Error.Code)
	assert.NotEmpty(t, resp.Error.Message)
}

func TestFailHelper_VariousErrorCodes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name           string
		err            *errcode.Error
		expectedStatus int
		expectedCode   string
	}{
		{
			name:           "bad request",
			err:            errcode.ErrBadRequest,
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "bad_request",
		},
		{
			name:           "internal error",
			err:            errcode.ErrInternal,
			expectedStatus: http.StatusInternalServerError,
			expectedCode:   "internal_error",
		},
		{
			name:           "not found",
			err:            errcode.SessionNotFound,
			expectedStatus: http.StatusNotFound,
			expectedCode:   "session_not_found",
		},
		{
			// #2243: errcode.New normalizes 0 to 500 at construction; fail()
			// deliberately has no clamp of its own anymore.
			name:           "custom error constructed with a zero status",
			err:            errcode.New("CUSTOM_ERROR", "custom message", 0),
			expectedStatus: http.StatusInternalServerError,
			expectedCode:   "CUSTOM_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)

			fail(c, tt.err)

			assert.True(t, c.IsAborted())
			assert.Equal(t, tt.expectedStatus, w.Code)

			var resp errorResp
			err := json.Unmarshal(w.Body.Bytes(), &resp)
			require.NoError(t, err)
			assert.Equal(t, tt.expectedCode, resp.Error.Code)
		})
	}
}
