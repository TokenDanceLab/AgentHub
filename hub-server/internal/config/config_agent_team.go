package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"

	"github.com/agenthub/hub-server/internal/model"
)

// Residual pure-helper peel #1134: agent team config, defaults, and validation.

type AgentTeamConfig struct {
	MaxDelegationDepth       int           `mapstructure:"max_delegation_depth"`
	MaxActiveSubAgentsPerRun int           `mapstructure:"max_active_subagents_per_run"`
	MaxRouteRepeats          int           `mapstructure:"max_route_repeats"`
	MaxTasksPerTeamRun       int           `mapstructure:"max_tasks_per_team_run"`
	AssignmentTimeout        time.Duration `mapstructure:"assignment_timeout"`
	MaxTeamRunBudgetTokens   int64         `mapstructure:"max_team_run_budget_tokens"`
	MaxTeamRunBudgetUsagePct float64       `mapstructure:"max_team_run_budget_usage_pct"`
	CompeteMaxAgents         int           `mapstructure:"compete_max_agents"`
	HumanReviewEnabled       bool          `mapstructure:"human_review_enabled"`
}

func setAgentTeamDefaults(v *viper.Viper) {
	defaults := DefaultAgentTeamConfig()
	v.SetDefault("agent_team.max_delegation_depth", defaults.MaxDelegationDepth)
	v.SetDefault("agent_team.max_active_subagents_per_run", defaults.MaxActiveSubAgentsPerRun)
	v.SetDefault("agent_team.max_route_repeats", defaults.MaxRouteRepeats)
	v.SetDefault("agent_team.max_tasks_per_team_run", defaults.MaxTasksPerTeamRun)
	v.SetDefault("agent_team.assignment_timeout", defaults.AssignmentTimeout)
	v.SetDefault("agent_team.max_team_run_budget_tokens", defaults.MaxTeamRunBudgetTokens)
	v.SetDefault("agent_team.max_team_run_budget_usage_pct", defaults.MaxTeamRunBudgetUsagePct)
	v.SetDefault("agent_team.compete_max_agents", defaults.CompeteMaxAgents)
}

func DefaultAgentTeamConfig() AgentTeamConfig {
	return AgentTeamConfig{
		MaxDelegationDepth:       model.MaxDelegationDepth,
		MaxActiveSubAgentsPerRun: model.MaxActiveSubAgentsPerRun,
		MaxRouteRepeats:          model.MaxRouteRepeats,
		MaxTasksPerTeamRun:       model.MaxTasksPerTeamRun,
		AssignmentTimeout:        model.DefaultAssignmentTimeout,
		MaxTeamRunBudgetTokens:   model.MaxTeamRunBudgetTokens,
		MaxTeamRunBudgetUsagePct: model.MaxTeamRunBudgetUsagePct,
		CompeteMaxAgents:         model.CompeteMaxAgentsDefault,
	}
}

func (a AgentTeamConfig) withDefaults() AgentTeamConfig {
	defaults := DefaultAgentTeamConfig()
	if a.MaxDelegationDepth == 0 {
		a.MaxDelegationDepth = defaults.MaxDelegationDepth
	}
	if a.MaxActiveSubAgentsPerRun == 0 {
		a.MaxActiveSubAgentsPerRun = defaults.MaxActiveSubAgentsPerRun
	}
	if a.MaxRouteRepeats == 0 {
		a.MaxRouteRepeats = defaults.MaxRouteRepeats
	}
	if a.MaxTasksPerTeamRun == 0 {
		a.MaxTasksPerTeamRun = defaults.MaxTasksPerTeamRun
	}
	if a.AssignmentTimeout == 0 {
		a.AssignmentTimeout = defaults.AssignmentTimeout
	}
	if a.MaxTeamRunBudgetTokens == 0 {
		a.MaxTeamRunBudgetTokens = defaults.MaxTeamRunBudgetTokens
	}
	if a.MaxTeamRunBudgetUsagePct == 0 {
		a.MaxTeamRunBudgetUsagePct = defaults.MaxTeamRunBudgetUsagePct
	}
	if a.CompeteMaxAgents <= 0 {
		a.CompeteMaxAgents = defaults.CompeteMaxAgents
	}
	return a
}

func (a AgentTeamConfig) Validate() error {
	if a.MaxDelegationDepth < 0 {
		return fmt.Errorf("agent_team.max_delegation_depth must be non-negative")
	}
	if a.MaxActiveSubAgentsPerRun < 0 {
		return fmt.Errorf("agent_team.max_active_subagents_per_run must be non-negative")
	}
	if a.MaxRouteRepeats < 0 {
		return fmt.Errorf("agent_team.max_route_repeats must be non-negative")
	}
	if a.MaxTasksPerTeamRun < 0 {
		return fmt.Errorf("agent_team.max_tasks_per_team_run must be non-negative")
	}
	if a.AssignmentTimeout < 0 {
		return fmt.Errorf("agent_team.assignment_timeout must be non-negative")
	}
	if a.MaxTeamRunBudgetTokens < 0 {
		return fmt.Errorf("agent_team.max_team_run_budget_tokens must be non-negative")
	}
	if a.MaxTeamRunBudgetUsagePct < 0 || a.MaxTeamRunBudgetUsagePct > 100 {
		return fmt.Errorf("agent_team.max_team_run_budget_usage_pct must be between 0 and 100")
	}
	return nil
}
