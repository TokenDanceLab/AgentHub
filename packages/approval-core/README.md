# AgentHub Approval Core

Shared Go domain models for approvals.

Owns:

- ApprovalRequest.
- ApprovalDecision.
- risk level.
- policy metadata.

Policy evaluation lives in Edge. Runner pauses and resumes based on Edge decisions.
