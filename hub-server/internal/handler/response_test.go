package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
)

func TestOK(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	t.Run("data is nil", func(t *testing.T) {
		OK(c, nil)
		assert.Equal(t, http.StatusOK, w.Code)

		var resp Response
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		assert.Equal(t, errcode.OK.Code, resp.Code)
		assert.Equal(t, "", resp.Message)
		assert.Nil(t, resp.Data)
	})

	t.Run("data is a map", func(t *testing.T) {
		w2 := httptest.NewRecorder()
		c2, _ := gin.CreateTestContext(w2)
		OK(c2, gin.H{"user_id": "abc-123"})
		assert.Equal(t, http.StatusOK, w2.Code)

		var resp Response
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
		assert.Equal(t, errcode.OK.Code, resp.Code)
		data, ok := resp.Data.(map[string]interface{})
		require.True(t, ok)
		assert.Equal(t, "abc-123", data["user_id"])
	})

	t.Run("data is a struct", func(t *testing.T) {
		w2 := httptest.NewRecorder()
		c2, _ := gin.CreateTestContext(w2)
		type testData struct {
			Name string `json:"name"`
		}
		OK(c2, testData{Name: "test"})
		assert.Equal(t, http.StatusOK, w2.Code)

		var resp Response
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
		assert.Equal(t, errcode.OK.Code, resp.Code)
		data, ok := resp.Data.(map[string]interface{})
		require.True(t, ok)
		assert.Equal(t, "test", data["name"])
	})

	t.Run("data is a slice", func(t *testing.T) {
		w2 := httptest.NewRecorder()
		c2, _ := gin.CreateTestContext(w2)
		OK(c2, []string{"a", "b"})
		assert.Equal(t, http.StatusOK, w2.Code)

		var resp Response
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
		assert.Equal(t, errcode.OK.Code, resp.Code)
		_, ok := resp.Data.([]interface{})
		assert.True(t, ok)
	})
}

func TestFail(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		err        *errcode.Error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{
			name:       "bad request",
			err:        errcode.ErrBadRequest,
			wantStatus: http.StatusBadRequest,
			wantCode:   errcode.ErrBadRequest.Code,
			wantMsg:    errcode.ErrBadRequest.Message,
		},
		{
			name:       "internal error",
			err:        errcode.ErrInternal,
			wantStatus: http.StatusInternalServerError,
			wantCode:   errcode.ErrInternal.Code,
			wantMsg:    errcode.ErrInternal.Message,
		},
		{
			name:       "not found",
			err:        errcode.UserNotFound,
			wantStatus: http.StatusNotFound,
			wantCode:   errcode.UserNotFound.Code,
			wantMsg:    errcode.UserNotFound.Message,
		},
		{
			name:       "unauthorized",
			err:        errcode.AuthInvalidToken,
			wantStatus: http.StatusUnauthorized,
			wantCode:   errcode.AuthInvalidToken.Code,
			wantMsg:    errcode.AuthInvalidToken.Message,
		},
		{
			name:       "conflict",
			err:        errcode.UserUsernameTaken,
			wantStatus: http.StatusConflict,
			wantCode:   errcode.UserUsernameTaken.Code,
			wantMsg:    errcode.UserUsernameTaken.Message,
		},
		{
			name:       "forbidden",
			err:        errcode.SessionNotMember,
			wantStatus: http.StatusForbidden,
			wantCode:   errcode.SessionNotMember.Code,
			wantMsg:    errcode.SessionNotMember.Message,
		},
		{
			name:       "gone",
			err:        errcode.SessionDissolved,
			wantStatus: http.StatusGone,
			wantCode:   errcode.SessionDissolved.Code,
			wantMsg:    errcode.SessionDissolved.Message,
		},
		{
			name:       "OK error (uses its own HTTP status)",
			err:        errcode.OK,
			wantStatus: http.StatusOK,
			wantCode:   errcode.OK.Code,
			wantMsg:    errcode.OK.Message,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			Fail(c, tt.err)

			assert.Equal(t, tt.wantStatus, w.Code)
			var resp Response
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
			assert.Equal(t, tt.wantCode, resp.Code)
			assert.Equal(t, tt.wantMsg, resp.Message)
			assert.Nil(t, resp.Data)
		})
	}
}

func TestFailWithMessage(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("custom message overrides default", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		customMsg := "username must be at least 4 characters"
		FailWithMessage(c, errcode.ErrBadRequest, customMsg)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		var resp Response
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		assert.Equal(t, errcode.ErrBadRequest.Code, resp.Code)
		assert.Equal(t, customMsg, resp.Message)
		assert.Nil(t, resp.Data)
	})

	t.Run("internal error with custom message", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		customMsg := "database connection lost"
		FailWithMessage(c, errcode.ErrInternal, customMsg)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
		var resp Response
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		assert.Equal(t, errcode.ErrInternal.Code, resp.Code)
		assert.Equal(t, customMsg, resp.Message)
	})

	t.Run("empty custom message", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		FailWithMessage(c, errcode.ErrBadRequest, "")

		assert.Equal(t, http.StatusBadRequest, w.Code)
		var resp Response
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		assert.Equal(t, errcode.ErrBadRequest.Code, resp.Code)
		assert.Equal(t, "", resp.Message)
	})
}
