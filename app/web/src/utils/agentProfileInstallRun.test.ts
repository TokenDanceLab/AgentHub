import { describe, expect, it } from 'vitest';
import { mapHubAgentProfileToAgentInfo } from '@/api/agentQueries';
import {
  AGENT_PROFILE_INSTALL_FIXTURE_CATALOG,
  buildInstalledAgentProfileTaskCreateRequest,
  installAgentProfileFixture,
} from './agentProfileInstallRun';

describe('agent profile marketplace install-to-run fixture', () => {
  const specReviewerFixture = AGENT_PROFILE_INSTALL_FIXTURE_CATALOG[0]!;

  it('installs a fixture catalog profile with a local Edge target preference', () => {
    const installedProfile = installAgentProfileFixture(
      specReviewerFixture,
      {
        id: 'target-local-edge-1',
        name: 'Alpha Desktop',
        target_type: 'local_edge',
        workspace_root: 'D:\\Code\\TokenDance\\AgentHub',
      },
    );
    const agent = mapHubAgentProfileToAgentInfo(installedProfile);

    expect(installedProfile).toMatchObject({
      id: 'installed-fixture-spec-reviewer',
      name: 'Spec Reviewer',
      runtime_id: 'codex',
      provider: 'openai',
      model: 'gpt-5-codex',
      approval_policy: 'on-request',
      permission_mode: 'workspace-write',
    });
    expect(agent).toMatchObject({
      id: 'installed-fixture-spec-reviewer',
      profileId: 'installed-fixture-spec-reviewer',
      name: 'Spec Reviewer',
      runtimeId: 'codex',
      provider: 'openai',
      model: 'gpt-5-codex',
      approvalPolicy: 'on-request',
      permissionMode: 'workspace-write',
      skills: ['Code Review', 'Diff Audit', 'Acceptance Evidence'],
      toolAllowlist: ['Read File', 'Git Diff'],
      targetPreferences: {
        target_id: 'target-local-edge-1',
        target_type: 'local_edge',
        target_name: 'Alpha Desktop',
        work_dir: 'D:\\Code\\TokenDance\\AgentHub',
        source: 'agent-market-install-fixture',
      },
      status: 'available',
    });
  });

  it('builds the Hub agent task create fields without triggering a real run', () => {
    const installedProfile = installAgentProfileFixture(
      specReviewerFixture,
      {
        id: 'target-local-edge-1',
        target_type: 'local_edge',
        workspace_root: 'D:\\Code\\TokenDance\\AgentHub',
      },
    );
    const agent = mapHubAgentProfileToAgentInfo(installedProfile);
    const request = buildInstalledAgentProfileTaskCreateRequest({
      agent,
      triggerMessageId: 'msg-market-install-1',
      agentInstanceId: 'agent-instance-spec-reviewer',
    });

    expect(request).toMatchObject({
      trigger_message_id: 'msg-market-install-1',
      agent_instance_id: 'agent-instance-spec-reviewer',
      agent_type: 'codex',
      custom_agent_id: 'installed-fixture-spec-reviewer',
      target_id: 'target-local-edge-1',
    });
    expect(JSON.parse(request.model_params)).toMatchObject({
      source: 'agent-market-install-fixture',
      profile_id: 'installed-fixture-spec-reviewer',
      runtime_id: 'codex',
      provider: 'openai',
      model: 'gpt-5-codex',
      reasoning_effort: 'high',
      approval_policy: 'on-request',
      permission_mode: 'workspace-write',
      work_dir: 'D:\\Code\\TokenDance\\AgentHub',
      target_preferences: {
        target_id: 'target-local-edge-1',
        target_type: 'local_edge',
      },
    });
  });

  it('fails closed when an installed profile has no target binding', () => {
    expect(() => buildInstalledAgentProfileTaskCreateRequest({
      agent: {
        id: 'installed-no-target',
        name: 'No Target',
        runtimeId: 'codex',
      },
      triggerMessageId: 'msg-no-target',
    })).toThrow('missing target_preferences.target_id');
  });
});
