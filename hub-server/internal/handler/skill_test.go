package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/skill"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockSkillService struct {
	create       func(ctx context.Context, ownerID string, req *model.Skill) (*model.Skill, error)
	get          func(ctx context.Context, id, ownerID string) (*model.Skill, error)
	update       func(ctx context.Context, id, ownerID string, req *model.Skill) (*model.Skill, error)
	delete       func(ctx context.Context, id, ownerID string) error
	list         func(ctx context.Context, ownerID, q, skillType, cursor string, pageSize int) (*skill.ListResult, error)
	publish      func(ctx context.Context, id, ownerID string) error
	unpublish    func(ctx context.Context, id, ownerID string) error
	searchPublic func(ctx context.Context, q, skillType, cursor string, pageSize int) (*skill.ListResult, error)
}

func (m *mockSkillService) Create(ctx context.Context, ownerID string, req *model.Skill) (*model.Skill, error) {
	if m.create == nil {
		return nil, nil
	}
	return m.create(ctx, ownerID, req)
}

func (m *mockSkillService) Get(ctx context.Context, id, ownerID string) (*model.Skill, error) {
	if m.get == nil {
		return nil, nil
	}
	return m.get(ctx, id, ownerID)
}

func (m *mockSkillService) Update(ctx context.Context, id, ownerID string, req *model.Skill) (*model.Skill, error) {
	if m.update == nil {
		return nil, nil
	}
	return m.update(ctx, id, ownerID, req)
}

func (m *mockSkillService) Delete(ctx context.Context, id, ownerID string) error {
	if m.delete == nil {
		return nil
	}
	return m.delete(ctx, id, ownerID)
}

func (m *mockSkillService) List(ctx context.Context, ownerID, q, skillType, cursor string, pageSize int) (*skill.ListResult, error) {
	if m.list == nil {
		return &skill.ListResult{}, nil
	}
	return m.list(ctx, ownerID, q, skillType, cursor, pageSize)
}

func (m *mockSkillService) Publish(ctx context.Context, id, ownerID string) error {
	if m.publish == nil {
		return nil
	}
	return m.publish(ctx, id, ownerID)
}

func (m *mockSkillService) Unpublish(ctx context.Context, id, ownerID string) error {
	if m.unpublish == nil {
		return nil
	}
	return m.unpublish(ctx, id, ownerID)
}

func (m *mockSkillService) SearchPublic(ctx context.Context, q, skillType, cursor string, pageSize int) (*skill.ListResult, error) {
	if m.searchPublic == nil {
		return &skill.ListResult{}, nil
	}
	return m.searchPublic(ctx, q, skillType, cursor, pageSize)
}

func TestSkillHandler_CreateSkill(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockSkillService{
			create: func(ctx context.Context, ownerID string, req *model.Skill) (*model.Skill, error) {
				called = true
				assert.Equal(t, "user-1", ownerID)
				assert.Equal(t, "My Skill", req.Name)
				assert.Equal(t, "code_review", req.SkillType)
				return &model.Skill{ID: "skill-1", Name: req.Name, SkillType: req.SkillType}, nil
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.POST("/web/skills", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.CreateSkill(c)
		})

		body := bytes.NewBufferString(`{"name":"My Skill","skill_type":"code_review","description":"A code review skill"}`)
		req := httptest.NewRequest(http.MethodPost, "/web/skills", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "skill-1")
	})

	t.Run("bad request - missing required fields", func(t *testing.T) {
		svc := &mockSkillService{}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.POST("/web/skills", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.CreateSkill(c)
		})

		body := bytes.NewBufferString(`{}`)
		req := httptest.NewRequest(http.MethodPost, "/web/skills", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockSkillService{
			create: func(ctx context.Context, ownerID string, req *model.Skill) (*model.Skill, error) {
				return nil, errcode.ErrInternal
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.POST("/web/skills", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.CreateSkill(c)
		})

		body := bytes.NewBufferString(`{"name":"My Skill","skill_type":"code_review"}`)
		req := httptest.NewRequest(http.MethodPost, "/web/skills", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestSkillHandler_GetSkill(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockSkillService{
			get: func(ctx context.Context, id, ownerID string) (*model.Skill, error) {
				called = true
				assert.Equal(t, "skill-1", id)
				assert.Equal(t, "user-1", ownerID)
				return &model.Skill{ID: "skill-1", Name: "Test Skill"}, nil
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.GET("/web/skills/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.GetSkill(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/skills/skill-1", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "skill-1")
	})

	t.Run("not found", func(t *testing.T) {
		svc := &mockSkillService{
			get: func(ctx context.Context, id, ownerID string) (*model.Skill, error) {
				return nil, errcode.AgentNotFound
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.GET("/web/skills/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.GetSkill(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/skills/nonexistent", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestSkillHandler_ListSkills(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockSkillService{
		list: func(ctx context.Context, ownerID, q, skillType, cursor string, pageSize int) (*skill.ListResult, error) {
			called = true
			assert.Equal(t, "user-1", ownerID)
			return &skill.ListResult{
				Items:   []model.Skill{{ID: "skill-1"}},
				Cursor:  "next",
				HasMore: true,
			}, nil
		},
	}
	h := NewSkillHandler(svc)

	r := gin.New()
	r.GET("/web/skills", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListSkills(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/skills", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "skill-1")
}

func TestSkillHandler_ListSkills_Public(t *testing.T) {
	gin.SetMode(gin.TestMode)

	searchPublicCalled := false
	listCalled := false
	svc := &mockSkillService{
		searchPublic: func(ctx context.Context, q, skillType, cursor string, pageSize int) (*skill.ListResult, error) {
			searchPublicCalled = true
			assert.Equal(t, "agent_skill", skillType)
			return &skill.ListResult{
				Items:   []model.Skill{{ID: "public-skill-1", Name: "Public Skill"}},
				HasMore: false,
			}, nil
		},
		list: func(ctx context.Context, ownerID, q, skillType, cursor string, pageSize int) (*skill.ListResult, error) {
			listCalled = true
			return &skill.ListResult{}, nil
		},
	}
	h := NewSkillHandler(svc)

	r := gin.New()
	r.GET("/web/skills", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListSkills(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/skills?is_public=true&skill_type=agent_skill", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, searchPublicCalled, "SearchPublic should be called when is_public=true")
	require.False(t, listCalled, "List should NOT be called when is_public=true")
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "public-skill-1")
}

func TestSkillHandler_UpdateSkill(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockSkillService{
			update: func(ctx context.Context, id, ownerID string, req *model.Skill) (*model.Skill, error) {
				called = true
				assert.Equal(t, "skill-1", id)
				assert.Equal(t, "user-1", ownerID)
				return &model.Skill{ID: id, Name: "Updated Skill"}, nil
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.PUT("/web/skills/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.UpdateSkill(c)
		})

		body := bytes.NewBufferString(`{"name":"Updated Skill"}`)
		req := httptest.NewRequest(http.MethodPut, "/web/skills/skill-1", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("bad request", func(t *testing.T) {
		svc := &mockSkillService{}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.PUT("/web/skills/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.UpdateSkill(c)
		})

		body := bytes.NewBufferString(`invalid json`)
		req := httptest.NewRequest(http.MethodPut, "/web/skills/skill-1", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestSkillHandler_DeleteSkill(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockSkillService{
			delete: func(ctx context.Context, id, ownerID string) error {
				called = true
				assert.Equal(t, "skill-1", id)
				assert.Equal(t, "user-1", ownerID)
				return nil
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.DELETE("/web/skills/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.DeleteSkill(c)
		})

		req := httptest.NewRequest(http.MethodDelete, "/web/skills/skill-1", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("not found", func(t *testing.T) {
		svc := &mockSkillService{
			delete: func(ctx context.Context, id, ownerID string) error {
				return errcode.AgentNotFound
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.DELETE("/web/skills/:id", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.DeleteSkill(c)
		})

		req := httptest.NewRequest(http.MethodDelete, "/web/skills/nonexistent", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestSkillHandler_PublishSkill(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockSkillService{
			publish: func(ctx context.Context, id, ownerID string) error {
				called = true
				assert.Equal(t, "skill-1", id)
				return nil
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.POST("/web/skills/:id/publish", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.PublishSkill(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/skills/skill-1/publish", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockSkillService{
			publish: func(ctx context.Context, id, ownerID string) error {
				return errcode.ErrInternal
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.POST("/web/skills/:id/publish", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.PublishSkill(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/skills/skill-1/publish", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestSkillHandler_UnpublishSkill(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockSkillService{
			unpublish: func(ctx context.Context, id, ownerID string) error {
				called = true
				assert.Equal(t, "skill-1", id)
				return nil
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.POST("/web/skills/:id/unpublish", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.UnpublishSkill(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/skills/skill-1/unpublish", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockSkillService{
			unpublish: func(ctx context.Context, id, ownerID string) error {
				return errcode.AgentNotFound
			},
		}
		h := NewSkillHandler(svc)

		r := gin.New()
		r.POST("/web/skills/:id/unpublish", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.UnpublishSkill(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/skills/skill-1/unpublish", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}
