package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/providerbinding"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockProviderBindingService struct {
	create func(ctx context.Context, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error)
	get    func(ctx context.Context, id, ownerID string) (*model.ProviderBinding, error)
	update func(ctx context.Context, id, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error)
	delete func(ctx context.Context, id, ownerID string) error
	list   func(ctx context.Context, ownerID, cursor string, pageSize int) (*providerbinding.ListResult, error)
}

func (m *mockProviderBindingService) Create(ctx context.Context, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error) {
	if m.create == nil {
		return nil, nil
	}
	return m.create(ctx, ownerID, req)
}

func (m *mockProviderBindingService) Get(ctx context.Context, id, ownerID string) (*model.ProviderBinding, error) {
	if m.get == nil {
		return nil, nil
	}
	return m.get(ctx, id, ownerID)
}

func (m *mockProviderBindingService) Update(ctx context.Context, id, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error) {
	if m.update == nil {
		return nil, nil
	}
	return m.update(ctx, id, ownerID, req)
}

func (m *mockProviderBindingService) Delete(ctx context.Context, id, ownerID string) error {
	if m.delete == nil {
		return nil
	}
	return m.delete(ctx, id, ownerID)
}

func (m *mockProviderBindingService) List(ctx context.Context, ownerID, cursor string, pageSize int) (*providerbinding.ListResult, error) {
	if m.list == nil {
		return &providerbinding.ListResult{}, nil
	}
	return m.list(ctx, ownerID, cursor, pageSize)
}

func TestProviderBindingHandler_List(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockProviderBindingService{
			list: func(ctx context.Context, ownerID, cursor string, pageSize int) (*providerbinding.ListResult, error) {
				called = true
				assert.Equal(t, "user-1", ownerID)
				return &providerbinding.ListResult{
					Items:   []model.ProviderBinding{{ID: "pb-1"}},
					Cursor:  "next",
					HasMore: true,
				}, nil
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.GET("/web/provider-bindings", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.List(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/provider-bindings", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "pb-1")
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockProviderBindingService{
			list: func(ctx context.Context, ownerID, cursor string, pageSize int) (*providerbinding.ListResult, error) {
				return nil, errcode.ErrInternal
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.GET("/web/provider-bindings", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.List(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/provider-bindings", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestProviderBindingHandler_Create(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockProviderBindingService{
			create: func(ctx context.Context, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error) {
				called = true
				assert.Equal(t, "user-1", ownerID)
				assert.Equal(t, "openai", req.Provider)
				return &model.ProviderBinding{ID: "pb-1", Provider: req.Provider}, nil
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.POST("/web/provider-bindings", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Create(c)
		})

		body := bytes.NewBufferString(`{"provider":"openai","base_url":"https://api.openai.com"}`)
		req := httptest.NewRequest(http.MethodPost, "/web/provider-bindings", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "pb-1")
	})

	t.Run("bad request - missing provider", func(t *testing.T) {
		svc := &mockProviderBindingService{}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.POST("/web/provider-bindings", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Create(c)
		})

		body := bytes.NewBufferString(`{}`)
		req := httptest.NewRequest(http.MethodPost, "/web/provider-bindings", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockProviderBindingService{
			create: func(ctx context.Context, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error) {
				return nil, errcode.ErrInternal
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.POST("/web/provider-bindings", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Create(c)
		})

		body := bytes.NewBufferString(`{"provider":"openai"}`)
		req := httptest.NewRequest(http.MethodPost, "/web/provider-bindings", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestProviderBindingHandler_Update(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockProviderBindingService{
			update: func(ctx context.Context, id, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error) {
				called = true
				assert.Equal(t, "pb-1", id)
				assert.Equal(t, "user-1", ownerID)
				return &model.ProviderBinding{ID: id, Provider: "openai"}, nil
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.PUT("/web/provider-bindings/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Update(c)
		})

		body := bytes.NewBufferString(`{"base_url":"https://new-url.com"}`)
		req := httptest.NewRequest(http.MethodPut, "/web/provider-bindings/pb-1", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("bad request", func(t *testing.T) {
		svc := &mockProviderBindingService{}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.PUT("/web/provider-bindings/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Update(c)
		})

		body := bytes.NewBufferString(`invalid json`)
		req := httptest.NewRequest(http.MethodPut, "/web/provider-bindings/pb-1", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("not found", func(t *testing.T) {
		svc := &mockProviderBindingService{
			update: func(ctx context.Context, id, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error) {
				return nil, errcode.AgentNotFound
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.PUT("/web/provider-bindings/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Update(c)
		})

		body := bytes.NewBufferString(`{"base_url":"https://new-url.com"}`)
		req := httptest.NewRequest(http.MethodPut, "/web/provider-bindings/nonexistent", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestProviderBindingHandler_Delete(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockProviderBindingService{
			delete: func(ctx context.Context, id, ownerID string) error {
				called = true
				assert.Equal(t, "pb-1", id)
				assert.Equal(t, "user-1", ownerID)
				return nil
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.DELETE("/web/provider-bindings/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Delete(c)
		})

		req := httptest.NewRequest(http.MethodDelete, "/web/provider-bindings/pb-1", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("not found", func(t *testing.T) {
		svc := &mockProviderBindingService{
			delete: func(ctx context.Context, id, ownerID string) error {
				return errcode.AgentNotFound
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.DELETE("/web/provider-bindings/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Delete(c)
		})

		req := httptest.NewRequest(http.MethodDelete, "/web/provider-bindings/nonexistent", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("internal error", func(t *testing.T) {
		svc := &mockProviderBindingService{
			delete: func(ctx context.Context, id, ownerID string) error {
				return errcode.ErrInternal
			},
		}
		h := NewProviderBindingHandler(svc)

		r := gin.New()
		r.DELETE("/web/provider-bindings/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.Delete(c)
		})

		req := httptest.NewRequest(http.MethodDelete, "/web/provider-bindings/pb-1", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}
