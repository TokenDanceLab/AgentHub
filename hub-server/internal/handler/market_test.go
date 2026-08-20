package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agentprofile"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockMarketService struct {
	searchMarket func(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*agentprofile.ListResult, error)
	getPublic    func(ctx context.Context, id string) (*model.AgentProfile, error)
	install      func(ctx context.Context, id, installerID string) (*model.AgentProfile, error)
	rate         func(ctx context.Context, profileID, raterID string, score int) (float64, int, error)
}

func (m *mockMarketService) SearchMarket(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*agentprofile.ListResult, error) {
	if m.searchMarket == nil {
		return &agentprofile.ListResult{}, nil
	}
	return m.searchMarket(ctx, runtimeID, q, sortBy, cursor, pageSize)
}

func (m *mockMarketService) GetPublic(ctx context.Context, id string) (*model.AgentProfile, error) {
	if m.getPublic == nil {
		return nil, nil
	}
	return m.getPublic(ctx, id)
}

func (m *mockMarketService) Install(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
	if m.install == nil {
		return nil, nil
	}
	return m.install(ctx, id, installerID)
}

func (m *mockMarketService) Rate(ctx context.Context, profileID, raterID string, score int) (float64, int, error) {
	if m.rate == nil {
		return 0, 0, nil
	}
	return m.rate(ctx, profileID, raterID, score)
}

func TestMarketHandler_SearchMarketProfiles(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMarketService{
			searchMarket: func(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*agentprofile.ListResult, error) {
				called = true
				assert.Equal(t, "runtime-1", runtimeID)
				assert.Equal(t, "assistant", q)
				assert.Equal(t, "recent", sortBy)
				return &agentprofile.ListResult{
					Items:   []model.AgentProfile{{ID: "profile-1"}},
					Cursor:  "next-cursor",
					HasMore: true,
				}, nil
			},
		}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.GET("/web/market/profiles", func(c *gin.Context) {
			h.SearchMarketProfiles(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/market/profiles?runtime_id=runtime-1&q=assistant&sort_by=recent", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "profile-1")
		assert.Contains(t, w.Body.String(), "next-cursor")
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockMarketService{
			searchMarket: func(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*agentprofile.ListResult, error) {
				return nil, errcode.ErrInternal
			},
		}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.GET("/web/market/profiles", func(c *gin.Context) {
			h.SearchMarketProfiles(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/market/profiles", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestMarketHandler_GetMarketProfile(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMarketService{
			getPublic: func(ctx context.Context, id string) (*model.AgentProfile, error) {
				called = true
				assert.Equal(t, "profile-1", id)
				return &model.AgentProfile{ID: "profile-1", Name: "Test Agent"}, nil
			},
		}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.GET("/web/market/profiles/:id", func(c *gin.Context) {
			h.GetMarketProfile(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/market/profiles/profile-1", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "profile-1")
		assert.Contains(t, w.Body.String(), "Test Agent")
	})

	t.Run("not found", func(t *testing.T) {
		svc := &mockMarketService{
			getPublic: func(ctx context.Context, id string) (*model.AgentProfile, error) {
				return nil, errcode.AgentNotFound
			},
		}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.GET("/web/market/profiles/:id", func(c *gin.Context) {
			h.GetMarketProfile(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/market/profiles/nonexistent", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestMarketHandler_InstallMarketProfile(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMarketService{
			install: func(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
				called = true
				assert.Equal(t, "profile-1", id)
				assert.Equal(t, "user-1", installerID)
				return &model.AgentProfile{ID: "profile-1", Name: "Installed Agent"}, nil
			},
		}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.POST("/web/market/profiles/:id/install", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.InstallMarketProfile(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/market/profiles/profile-1/install", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "profile-1")
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockMarketService{
			install: func(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
				return nil, errcode.ErrInternal
			},
		}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.POST("/web/market/profiles/:id/install", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.InstallMarketProfile(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/market/profiles/profile-1/install", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestMarketHandler_RateMarketProfile(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMarketService{
			rate: func(ctx context.Context, profileID, raterID string, score int) (float64, int, error) {
				called = true
				assert.Equal(t, "profile-1", profileID)
				assert.Equal(t, "user-1", raterID)
				assert.Equal(t, 5, score)
				return 4.5, 10, nil
			},
		}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.POST("/web/market/profiles/:id/rate", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.RateMarketProfile(c)
		})

		body := bytes.NewBufferString(`{"score":5}`)
		req := httptest.NewRequest(http.MethodPost, "/web/market/profiles/profile-1/rate", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "4.5")
		assert.Contains(t, w.Body.String(), "10")
	})

	t.Run("bad request - missing score", func(t *testing.T) {
		svc := &mockMarketService{}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.POST("/web/market/profiles/:id/rate", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.RateMarketProfile(c)
		})

		body := bytes.NewBufferString(`{}`)
		req := httptest.NewRequest(http.MethodPost, "/web/market/profiles/profile-1/rate", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockMarketService{
			rate: func(ctx context.Context, profileID, raterID string, score int) (float64, int, error) {
				return 0, 0, errcode.AgentNotFound
			},
		}
		h := NewMarketHandler(svc)

		r := gin.New()
		r.POST("/web/market/profiles/:id/rate", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.RateMarketProfile(c)
		})

		body := bytes.NewBufferString(`{"score":5}`)
		req := httptest.NewRequest(http.MethodPost, "/web/market/profiles/profile-1/rate", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}
