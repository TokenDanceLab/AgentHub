package agentteam

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/model"
)

// This file is the thin facade: AgentTeamService's dependency interfaces,
// construction and wiring. The behaviour lives in this package's sibling
// files, split by responsibility — team CRUD, membership, approvals,
// guardrails, the TeamRun lifecycle, supervisor route decisions and their pure
// helpers, pure TeamRunState projection, assignment lifecycle, replay, review,
// compete aggregation, audit and authz.
//
// The split is deliberately described instead of enumerated: this comment used
// to list file names, and the list had already rotted — it named a routing file
// that does not exist and had never heard of six that do. The package directory
// is the only file list that stays true (#2246).

type agentTeamAgentSvc interface {
	AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error)
	TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error)
}

type agentTeamCache interface {
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
	InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error
}

type agentTeamControlSvc interface {
	DeliverToDesktopDevice(ctx context.Context, userID, deviceID string, payload model.AgentControlPayload) error
}

type AgentTeamService struct {
	db                 *gorm.DB
	agentSvc           agentTeamAgentSvc
	cacheClient        agentTeamCache
	controlSvc         agentTeamControlSvc
	bus                *bus.Bus
	guardrails         AgentTeamGuardrails
	competeAggregator  CompeteAggregator
	competeMaxAgents   int
	humanReviewEnabled bool
	audit              PrivilegedActionAuditor
}

type AgentTeamGuardrails struct {
	MaxDelegationDepth       int
	MaxActiveSubAgentsPerRun int64
	MaxRouteRepeats          int
	MaxTasksPerTeamRun       int64
	AssignmentTimeout        time.Duration
	MaxTeamRunBudgetTokens   int64
	MaxTeamRunBudgetUsagePct float64
}

func DefaultAgentTeamGuardrails() AgentTeamGuardrails {
	return AgentTeamGuardrails{
		MaxDelegationDepth:       model.MaxDelegationDepth,
		MaxActiveSubAgentsPerRun: model.MaxActiveSubAgentsPerRun,
		MaxRouteRepeats:          model.MaxRouteRepeats,
		MaxTasksPerTeamRun:       model.MaxTasksPerTeamRun,
		AssignmentTimeout:        model.DefaultAssignmentTimeout,
		MaxTeamRunBudgetTokens:   model.MaxTeamRunBudgetTokens,
		MaxTeamRunBudgetUsagePct: model.MaxTeamRunBudgetUsagePct,
	}
}

func (g AgentTeamGuardrails) normalized() AgentTeamGuardrails {
	defaults := DefaultAgentTeamGuardrails()
	if g.MaxDelegationDepth <= 0 {
		g.MaxDelegationDepth = defaults.MaxDelegationDepth
	}
	if g.MaxActiveSubAgentsPerRun <= 0 {
		g.MaxActiveSubAgentsPerRun = defaults.MaxActiveSubAgentsPerRun
	}
	if g.MaxRouteRepeats <= 0 {
		g.MaxRouteRepeats = defaults.MaxRouteRepeats
	}
	if g.MaxTasksPerTeamRun <= 0 {
		g.MaxTasksPerTeamRun = defaults.MaxTasksPerTeamRun
	}
	if g.AssignmentTimeout <= 0 {
		g.AssignmentTimeout = defaults.AssignmentTimeout
	}
	if g.MaxTeamRunBudgetTokens <= 0 {
		g.MaxTeamRunBudgetTokens = defaults.MaxTeamRunBudgetTokens
	}
	if g.MaxTeamRunBudgetUsagePct <= 0 {
		g.MaxTeamRunBudgetUsagePct = defaults.MaxTeamRunBudgetUsagePct
	}
	return g
}

func NewAgentTeamService(db *gorm.DB, agentSvc agentTeamAgentSvc, cacheClient *cache.Client) *AgentTeamService {
	return NewAgentTeamServiceWithGuardrails(db, agentSvc, cacheClient, DefaultAgentTeamGuardrails())
}
func NewAgentTeamServiceWithGuardrails(db *gorm.DB, agentSvc agentTeamAgentSvc, cacheClient *cache.Client, guardrails AgentTeamGuardrails) *AgentTeamService {
	return &AgentTeamService{
		db:               db,
		agentSvc:         agentSvc,
		cacheClient:      resolveAgentTeamCache(cacheClient),
		guardrails:       guardrails.normalized(),
		competeMaxAgents: model.CompeteMaxAgentsDefault,
	}
}

func (s *AgentTeamService) SetControlService(controlSvc agentTeamControlSvc) {
	s.controlSvc = controlSvc
}

func (s *AgentTeamService) SetBus(bus *bus.Bus) {
	s.bus = bus
}

// SetCompeteMaxAgents sets the maximum number of parallel agents in compete mode.

// SetAuditService injects the privileged-action auditor (#2067). nil disables recording.
func (s *AgentTeamService) SetAuditService(a PrivilegedActionAuditor) {
	if s == nil {
		return
	}
	s.audit = a
}
func (s *AgentTeamService) SetCompeteMaxAgents(n int) {
	if n > 0 {
		s.competeMaxAgents = n
	}
}

// SetHumanReviewEnabled sets whether the human review gate is active.
func (s *AgentTeamService) SetHumanReviewEnabled(enabled bool) {
	s.humanReviewEnabled = enabled
}

func resolveAgentTeamCache(c *cache.Client) agentTeamCache {
	if c == nil {
		return cache.NoOpCache{}
	}
	return c
}
