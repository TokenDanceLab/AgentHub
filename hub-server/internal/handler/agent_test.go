package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockAgentService struct {
	addAgentToSession      func(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error)
	triggerAgentTask       func(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error)
	cancelTask             func(ctx context.Context, userID, taskID string) error
	handleTaskAck          func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error
	handleTaskStream       func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error
	handleTaskDone         func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error
	handleTaskFail         func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error
	listTaskRunEvents      func(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error)
	getTaskRunEventSummary func(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error)
}

func (m *mockAgentService) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
	if m.addAgentToSession == nil {
		return &model.AgentInstance{}, nil
	}
	return m.addAgentToSession(ctx, userID, sessionID, agentType, customAgentID, displayName)
}

func (m *mockAgentService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	if m.triggerAgentTask == nil {
		return nil, nil
	}
	return m.triggerAgentTask(ctx, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID)
}

func (m *mockAgentService) CancelTask(ctx context.Context, userID, taskID string) error {
	if m.cancelTask == nil {
		return nil
	}
	return m.cancelTask(ctx, userID, taskID)
}

func (m *mockAgentService) HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
	if m.handleTaskAck == nil {
		return nil
	}
	return m.handleTaskAck(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID)
}

func (m *mockAgentService) HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
	if m.handleTaskStream == nil {
		return nil
	}
	return m.handleTaskStream(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, stream)
}

func (m *mockAgentService) HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
	if m.handleTaskDone == nil {
		return nil
	}
	return m.handleTaskDone(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent)
}

func (m *mockAgentService) HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
	if m.handleTaskFail == nil {
		return nil
	}
	return m.handleTaskFail(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg)
}

func (m *mockAgentService) ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	if m.listTaskRunEvents == nil {
		return nil, nil
	}
	return m.listTaskRunEvents(ctx, userID, taskID, filter)
}

func (m *mockAgentService) GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
	if m.getTaskRunEventSummary == nil {
		return nil, nil
	}
	return m.getTaskRunEventSummary(ctx, userID, taskID)
}

func TestAgentHandler_AddAgentToSession(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			addAgentToSession: func(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
				called = true
				assert.Equal(t, "user-1", userID)
				assert.Equal(t, "session-1", sessionID)
				assert.Equal(t, "coder", agentType)
				assert.Equal(t, "Code Agent", displayName)
				return &model.AgentInstance{
					ID:            "agent-instance-1",
					AgentType:     agentType,
					SessionID:     sessionID,
					InviterUserID: userID,
					DisplayName:   displayName,
				}, nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/client/sessions/:id/agents", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.AddAgentToSession(c)
		})

		body := bytes.NewBufferString(`{"agent_type":"coder","display_name":"Code Agent"}`)
		req := httptest.NewRequest(http.MethodPost, "/client/sessions/session-1/agents", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "agent-instance-1")
	})

	t.Run("bad request - missing required fields", func(t *testing.T) {
		svc := &mockAgentService{}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/client/sessions/:id/agents", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.AddAgentToSession(c)
		})

		body := bytes.NewBufferString(`{}`)
		req := httptest.NewRequest(http.MethodPost, "/client/sessions/session-1/agents", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("service error", func(t *testing.T) {
		svc := &mockAgentService{
			addAgentToSession: func(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
				return nil, errcode.SessionNotFound
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/client/sessions/:id/agents", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.AddAgentToSession(c)
		})

		body := bytes.NewBufferString(`{"agent_type":"coder","display_name":"Code Agent"}`)
		req := httptest.NewRequest(http.MethodPost, "/client/sessions/session-1/agents", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestAgentHandler_TriggerTask(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			triggerAgentTask: func(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
				called = true
				assert.Equal(t, "user-1", userID)
				assert.Equal(t, "msg-1", triggerMessageID)
				return &model.PendingAgentTask{ID: "task-1", Status: "queued"}, nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/web/agent-tasks", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.TriggerTask(c)
		})

		body := bytes.NewBufferString(`{"trigger_message_id":"msg-1"}`)
		req := httptest.NewRequest(http.MethodPost, "/web/agent-tasks", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "task-1")
	})

	t.Run("bad request", func(t *testing.T) {
		svc := &mockAgentService{}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/web/agent-tasks", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.TriggerTask(c)
		})

		body := bytes.NewBufferString(`{}`)
		req := httptest.NewRequest(http.MethodPost, "/web/agent-tasks", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestAgentHandler_CancelTask(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			cancelTask: func(ctx context.Context, userID, taskID string) error {
				called = true
				assert.Equal(t, "user-1", userID)
				assert.Equal(t, "task-1", taskID)
				return nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/web/agent-tasks/:id/cancel", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.CancelTask(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/agent-tasks/task-1/cancel", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("task not found", func(t *testing.T) {
		svc := &mockAgentService{
			cancelTask: func(ctx context.Context, userID, taskID string) error {
				return errcode.AgentTaskNotFound
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/web/agent-tasks/:id/cancel", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.CancelTask(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/web/agent-tasks/task-1/cancel", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestAgentHandler_TaskAck(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success with body", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			handleTaskAck: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
				called = true
				assert.Equal(t, "edge-user-1", edgeUserID)
				assert.Equal(t, "edge-device-1", edgeDeviceID)
				assert.Equal(t, "task-1", taskID)
				assert.Equal(t, "edge-run-1", edgeRunID)
				return nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/edge/agent-tasks/:id/ack", func(c *gin.Context) {
			c.Set("user_id", "edge-user-1")
			c.Set("device_id", "edge-device-1")
			h.TaskAck(c)
		})

		body := bytes.NewBufferString(`{"run_id":"run-1","edge_run_id":"edge-run-1"}`)
		req := httptest.NewRequest(http.MethodPost, "/edge/agent-tasks/task-1/ack", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("success with empty body", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			handleTaskAck: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
				called = true
				return nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/edge/agent-tasks/:id/ack", func(c *gin.Context) {
			c.Set("user_id", "edge-user-1")
			c.Set("device_id", "edge-device-1")
			h.TaskAck(c)
		})

		req := httptest.NewRequest(http.MethodPost, "/edge/agent-tasks/task-1/ack", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})
}

func TestAgentHandler_TaskStream(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			handleTaskStream: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
				called = true
				assert.Equal(t, "task-1", taskID)
				assert.Equal(t, "edge-run-1", edgeRunID)
				assert.Equal(t, "Hello", stream.Content)
				return nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/edge/agent-tasks/:id/stream", func(c *gin.Context) {
			c.Set("user_id", "edge-user-1")
			c.Set("device_id", "edge-device-1")
			h.TaskStream(c)
		})

		body := bytes.NewBufferString(`{"run_id":"run-1","edge_run_id":"edge-run-1","content":"Hello","event_type":"text"}`)
		req := httptest.NewRequest(http.MethodPost, "/edge/agent-tasks/task-1/stream", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("empty content fails", func(t *testing.T) {
		svc := &mockAgentService{}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/edge/agent-tasks/:id/stream", func(c *gin.Context) {
			c.Set("user_id", "edge-user-1")
			c.Set("device_id", "edge-device-1")
			h.TaskStream(c)
		})

		body := bytes.NewBufferString(`{"run_id":"run-1","event_type":"text"}`)
		req := httptest.NewRequest(http.MethodPost, "/edge/agent-tasks/task-1/stream", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestAgentHandler_TaskEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			listTaskRunEvents: func(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
				called = true
				assert.Equal(t, "user-1", userID)
				assert.Equal(t, "task-1", taskID)
				return []model.AgentRunEvent{{EventSeq: 1, EventType: "text"}}, nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.GET("/web/agent-tasks/:id/events", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.TaskEvents(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/agent-tasks/task-1/events", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("invalid limit param", func(t *testing.T) {
		svc := &mockAgentService{}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.GET("/web/agent-tasks/:id/events", func(c *gin.Context) {
			c.Set("user_id", "user-1")
			h.TaskEvents(c)
		})

		req := httptest.NewRequest(http.MethodGet, "/web/agent-tasks/task-1/events?limit=invalid", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestAgentHandler_TaskEventSummary(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentService{
		getTaskRunEventSummary: func(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "task-1", taskID)
			return &model.AgentRunEventSummary{TotalEvents: 10}, nil
		},
	}
	h := NewAgentHandler(svc)

	r := gin.New()
	r.GET("/web/agent-tasks/:id/events/summary", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.TaskEventSummary(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/agent-tasks/task-1/events/summary", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "10")
}

func TestAgentHandler_TaskDone(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			handleTaskDone: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
				called = true
				assert.Equal(t, "task-1", taskID)
				assert.Equal(t, "edge-run-1", edgeRunID)
				assert.Equal(t, "Final output", finalContent)
				return nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/edge/agent-tasks/:id/done", func(c *gin.Context) {
			c.Set("user_id", "edge-user-1")
			c.Set("device_id", "edge-device-1")
			h.TaskDone(c)
		})

		body := bytes.NewBufferString(`{"run_id":"run-1","edge_run_id":"edge-run-1","final_content":"Final output"}`)
		req := httptest.NewRequest(http.MethodPost, "/edge/agent-tasks/task-1/done", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("bad request", func(t *testing.T) {
		svc := &mockAgentService{}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/edge/agent-tasks/:id/done", func(c *gin.Context) {
			c.Set("user_id", "edge-user-1")
			c.Set("device_id", "edge-device-1")
			h.TaskDone(c)
		})

		body := bytes.NewBufferString(`invalid json`)
		req := httptest.NewRequest(http.MethodPost, "/edge/agent-tasks/task-1/done", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestAgentHandler_TaskFail(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("success", func(t *testing.T) {
		called := false
		svc := &mockAgentService{
			handleTaskFail: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
				called = true
				assert.Equal(t, "task-1", taskID)
				assert.Equal(t, "edge-run-1", edgeRunID)
				assert.Equal(t, "timeout error", errMsg)
				return nil
			},
		}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/edge/agent-tasks/:id/fail", func(c *gin.Context) {
			c.Set("user_id", "edge-user-1")
			c.Set("device_id", "edge-device-1")
			h.TaskFail(c)
		})

		body := bytes.NewBufferString(`{"run_id":"run-1","edge_run_id":"edge-run-1","error":"timeout error"}`)
		req := httptest.NewRequest(http.MethodPost, "/edge/agent-tasks/task-1/fail", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		require.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("missing error field", func(t *testing.T) {
		svc := &mockAgentService{}
		h := NewAgentHandler(svc)

		r := gin.New()
		r.POST("/edge/agent-tasks/:id/fail", func(c *gin.Context) {
			c.Set("user_id", "edge-user-1")
			c.Set("device_id", "edge-device-1")
			h.TaskFail(c)
		})

		body := bytes.NewBufferString(`{"run_id":"run-1"}`)
		req := httptest.NewRequest(http.MethodPost, "/edge/agent-tasks/task-1/fail", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}
