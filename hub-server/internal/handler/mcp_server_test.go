package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/mcpserver"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockMCPService struct {
	create       func(ctx context.Context, ownerID string, req *model.MCPServer) (*model.MCPServer, error)
	get          func(ctx context.Context, id, ownerID string) (*model.MCPServer, error)
	update       func(ctx context.Context, id, ownerID string, req *model.MCPServer) (*model.MCPServer, error)
	delete       func(ctx context.Context, id, ownerID string) error
	list         func(ctx context.Context, ownerID, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error)
	publish      func(ctx context.Context, id, ownerID string) error
	unpublish    func(ctx context.Context, id, ownerID string) error
	searchPublic func(ctx context.Context, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error)
}

func (m *mockMCPService) Create(ctx context.Context, ownerID string, req *model.MCPServer) (*model.MCPServer, error) {
	if m.create == nil {
		return nil, nil
	}
	return m.create(ctx, ownerID, req)
}

func (m *mockMCPService) Get(ctx context.Context, id, ownerID string) (*model.MCPServer, error) {
	if m.get == nil {
		return nil, nil
	}
	return m.get(ctx, id, ownerID)
}

func (m *mockMCPService) Update(ctx context.Context, id, ownerID string, req *model.MCPServer) (*model.MCPServer, error) {
	if m.update == nil {
		return nil, nil
	}
	return m.update(ctx, id, ownerID, req)
}

func (m *mockMCPService) Delete(ctx context.Context, id, ownerID string) error {
	if m.delete == nil {
		return nil
	}
	return m.delete(ctx, id, ownerID)
}

func (m *mockMCPService) List(ctx context.Context, ownerID, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error) {
	if m.list == nil {
		return &mcpserver.ListResult{}, nil
	}
	return m.list(ctx, ownerID, q, transport, cursor, pageSize)
}

func (m *mockMCPService) Publish(ctx context.Context, id, ownerID string) error {
	if m.publish == nil {
		return nil
	}
	return m.publish(ctx, id, ownerID)
}

func (m *mockMCPService) Unpublish(ctx context.Context, id, ownerID string) error {
	if m.unpublish == nil {
		return nil
	}
	return m.unpublish(ctx, id, ownerID)
}

func (m *mockMCPService) SearchPublic(ctx context.Context, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error) {
	if m.searchPublic == nil {
		return &mcpserver.ListResult{}, nil
	}
	return m.searchPublic(ctx, q, transport, cursor, pageSize)
}

func TestMCPServerHandler_CreateMCPServer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMCPService{
			create: func(ctx context.Context, ownerID string, req *model.MCPServer) (*model.MCPServer, error) {
				called = true
				assert.Equal(t, "user-1", ownerID)
				assert.Equal(t, "My MCP Server", req.Name)
				assert.Equal(t, "stdio", req.Transport)
				return &model.MCPServer{ID: "mcp-1", Name: req.Name, Transport: req.Transport}, nil
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.POST("/web/mcp-servers", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.CreateMCPServer(c)
		})

		body := bytes.NewBufferString(`{"name":"My MCP Server","transport":"stdio","command":"node"}`)
		req := httptest.NewRequest(http.MethodPost, "/web/mcp-servers", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "mcp-1")
	})

	t.Run("bad request - missing required fields", func(t *testing.T) {
		svc := &mockMCPService{}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.POST("/web/mcp-servers", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.CreateMCPServer(c)
		})

		body := bytes.NewBufferString(`{}`)
		req := httptest.NewRequest(http.MethodPost, "/web/mcp-servers", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockMCPService{
			create: func(ctx context.Context, ownerID string, req *model.MCPServer) (*model.MCPServer, error) {
				return nil, errcode.ErrInternal
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.POST("/web/mcp-servers", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.CreateMCPServer(c)
		})

		body := bytes.NewBufferString(`{"name":"My MCP Server","transport":"stdio"}`)
		req := httptest.NewRequest(http.MethodPost, "/web/mcp-servers", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestMCPServerHandler_GetMCPServer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMCPService{
			get: func(ctx context.Context, id, ownerID string) (*model.MCPServer, error) {
				called = true
				assert.Equal(t, "mcp-1", id)
				assert.Equal(t, "user-1", ownerID)
				return &model.MCPServer{ID: "mcp-1", Name: "Test Server"}, nil
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.GET("/web/mcp-servers/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.GetMCPServer(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/mcp-servers/mcp-1", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "mcp-1")
	})

	t.Run("not found", func(t *testing.T) {
		svc := &mockMCPService{
			get: func(ctx context.Context, id, ownerID string) (*model.MCPServer, error) {
				return nil, errcode.AgentNotFound
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.GET("/web/mcp-servers/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.GetMCPServer(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/mcp-servers/nonexistent", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestMCPServerHandler_ListMCPServers(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockMCPService{
		list: func(ctx context.Context, ownerID, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error) {
			called = true
			assert.Equal(t, "user-1", ownerID)
			return &mcpserver.ListResult{
				Items:   []model.MCPServer{{ID: "mcp-1"}},
				Cursor:  "next",
				HasMore: true,
			}, nil
		},
	}
	h := NewMCPServerHandler(svc)

	r := gin.New()
	r.GET("/web/mcp-servers", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListMCPServers(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/mcp-servers", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "mcp-1")
}

func TestMCPServerHandler_UpdateMCPServer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMCPService{
			update: func(ctx context.Context, id, ownerID string, req *model.MCPServer) (*model.MCPServer, error) {
				called = true
				assert.Equal(t, "mcp-1", id)
				assert.Equal(t, "user-1", ownerID)
				return &model.MCPServer{ID: id, Name: "Updated Server"}, nil
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.PUT("/web/mcp-servers/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.UpdateMCPServer(c)
		})

		body := bytes.NewBufferString(`{"name":"Updated Server"}`)
		req := httptest.NewRequest(http.MethodPut, "/web/mcp-servers/mcp-1", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("bad request", func(t *testing.T) {
		svc := &mockMCPService{}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.PUT("/web/mcp-servers/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.UpdateMCPServer(c)
		})

		body := bytes.NewBufferString(`invalid json`)
		req := httptest.NewRequest(http.MethodPut, "/web/mcp-servers/mcp-1", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestMCPServerHandler_DeleteMCPServer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMCPService{
			delete: func(ctx context.Context, id, ownerID string) error {
				called = true
				assert.Equal(t, "mcp-1", id)
				assert.Equal(t, "user-1", ownerID)
				return nil
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.DELETE("/web/mcp-servers/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.DeleteMCPServer(c)
		})

		req := httptest.NewRequest(http.MethodDelete, "/web/mcp-servers/mcp-1", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("not found", func(t *testing.T) {
		svc := &mockMCPService{
			delete: func(ctx context.Context, id, ownerID string) error {
				return errcode.AgentNotFound
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.DELETE("/web/mcp-servers/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.DeleteMCPServer(c)
		})

		req := httptest.NewRequest(http.MethodDelete, "/web/mcp-servers/nonexistent", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestMCPServerHandler_PublishMCPServer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMCPService{
			publish: func(ctx context.Context, id, ownerID string) error {
				called = true
				assert.Equal(t, "mcp-1", id)
				return nil
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.POST("/web/mcp-servers/:id/publish", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.PublishMCPServer(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/mcp-servers/mcp-1/publish", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockMCPService{
			publish: func(ctx context.Context, id, ownerID string) error {
				return errcode.ErrInternal
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.POST("/web/mcp-servers/:id/publish", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.PublishMCPServer(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/mcp-servers/mcp-1/publish", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestMCPServerHandler_UnpublishMCPServer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockMCPService{
			unpublish: func(ctx context.Context, id, ownerID string) error {
				called = true
				assert.Equal(t, "mcp-1", id)
				return nil
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.POST("/web/mcp-servers/:id/unpublish", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.UnpublishMCPServer(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/mcp-servers/mcp-1/unpublish", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockMCPService{
			unpublish: func(ctx context.Context, id, ownerID string) error {
				return errcode.AgentNotFound
			},
		}
		h := NewMCPServerHandler(svc)

		r := gin.New()
		r.POST("/web/mcp-servers/:id/unpublish", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.UnpublishMCPServer(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/mcp-servers/mcp-1/unpublish", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}
