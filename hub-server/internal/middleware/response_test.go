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

func TestResponseBody_Structure(t *testing.T) {
	// Verify the responseBody struct has correct JSON tags
	rb := responseBody{
		Code:    "TEST_CODE",
		Message: "test message",
		Data:    map[string]string{"key": "value"},
	}

	data, err := json.Marshal(rb)
	require.NoError(t, err)

	var parsed map[string]interface{}
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, "TEST_CODE", parsed["code"])
	assert.Equal(t, "test message", parsed["message"])
	assert.NotNil(t, parsed["data"])
}

func TestResponseBody_OmitsEmptyData(t *testing.T) {
	// When Data is nil, it should be omitted from JSON
	rb := responseBody{
		Code:    "TEST_CODE",
		Message: "test message",
		Data:    nil,
	}

	data, err := json.Marshal(rb)
	require.NoError(t, err)

	var parsed map[string]interface{}
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	// Data should be omitted when nil
	_, hasData := parsed["data"]
	assert.False(t, hasData, "data field should be omitted when nil")
}

func TestFailHelper_ResponseFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)

	fail(c, errcode.ErrBadRequest)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusBadRequest, w.Code)

	var resp responseBody
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.Equal(t, "BAD_REQUEST", resp.Code)
	assert.NotEmpty(t, resp.Message)
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
			expectedCode:   "BAD_REQUEST",
		},
		{
			name:           "internal error",
			err:            errcode.ErrInternal,
			expectedStatus: http.StatusInternalServerError,
			expectedCode:   "INTERNAL_ERROR",
		},
		{
			name:           "not found",
			err:            errcode.SessionNotFound,
			expectedStatus: http.StatusNotFound,
			expectedCode:   "SESSION_NOT_FOUND",
		},
		{
			name:           "custom error with zero status",
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

			var resp responseBody
			err := json.Unmarshal(w.Body.Bytes(), &resp)
			require.NoError(t, err)
			assert.Equal(t, tt.expectedCode, resp.Code)
		})
	}
}
