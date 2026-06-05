CREATE INDEX IF NOT EXISTS idx_agent_team_tasks_team_run_id ON agent_team_tasks(team_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_team_assignments_team_run_id ON agent_team_assignments(team_run_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
