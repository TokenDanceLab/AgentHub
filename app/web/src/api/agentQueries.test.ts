import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '@/hooks/useAuth';
import {
  agentConfigToCreateAgentProfileRequest,
  agentConfigToUpdateAgentProfileRequest,
  fetchAgentList,
  mapHubAgentProfileToAgentInfo,
} from './agentQueries';

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(),
}));

describe('web agent profile queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(getAccessToken).mockReturnValue(null);
  });

  it('maps Hub AgentProfile runtime metadata into AgentInfo', () => {
    const agent = mapHubAgentProfileToAgentInfo({
      id: '00000000-0000-0000-0000-00000000c101',
      name: 'Reviewer',
      description: 'Reviews risky patches',
      runtime_id: 'codex',
      provider: 'openai',
      model: 'gpt-5.5',
      reasoning_effort: 'high',
      approval_policy: 'on-request',
      permission_mode: 'plan',
      skills: '["Code Review","Security"]',
      mcp_servers: '[{"name":"github"}]',
      tool_allowlist: '["Read","Grep"]',
      target_preferences: '{"work_dir":"D:\\\\Code\\\\TokenDance\\\\AgentHub"}',
      version: 3,
    });

    expect(agent).toMatchObject({
      id: '00000000-0000-0000-0000-00000000c101',
      name: 'Reviewer',
      profileId: '00000000-0000-0000-0000-00000000c101',
      runtimeId: 'codex',
      provider: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      approvalPolicy: 'on-request',
      permissionMode: 'plan',
      skills: ['Code Review', 'Security'],
      toolAllowlist: ['Read', 'Grep'],
      targetPreferences: { work_dir: 'D:\\Code\\TokenDance\\AgentHub' },
      description: 'Reviews risky patches - Runtime: codex - Model: openai/gpt-5.5',
      version: '3',
      status: 'available',
      capabilities: {
        streaming: true,
        toolCalls: true,
        fileChanges: true,
        thinkingVisible: true,
        multiTurn: true,
        mcpIntegration: true,
        permissionHooks: true,
        subAgentSpawn: false,
      },
    });
  });

  it('fetches real Hub agent profiles when a Hub session token is available', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/web/agent-profiles?pageSize=50');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer hub-access' });
      return new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            items: [
              {
                id: '00000000-0000-0000-0000-00000000c102',
                name: 'Builder',
                runtime_id: 'claude-code',
                model: 'sonnet',
                version: 1,
              },
            ],
            page: { hasMore: false },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchAgentList(true);

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: '00000000-0000-0000-0000-00000000c102',
      name: 'Builder',
      status: 'available',
      capabilities: {
        mcpIntegration: true,
        subAgentSpawn: true,
      },
    });
  });

  it('returns an empty list without calling Hub when there is no Hub token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchAgentList(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.items).toHaveLength(0);
    expect(res.page.hasMore).toBe(false);
  });

  it('maps editable Agent config into the current Hub JSON-string request contract', () => {
    const req = agentConfigToCreateAgentProfileRequest({
      id: 'draft-agent-1',
      name: ' Builder ',
      role: 'Code owner',
      engine: 'claude code',
      model: 'openai / gpt-5.5',
      mode: 'Reasoning high',
      approval: 'Hub 默认策略',
      scope: 'trusted',
      state: 'ready',
      skills: ['Review', 'Review', ' Security '],
      tools: {
        Read: '允许',
        Write: '需确认',
        Bash: '禁止',
      },
    });

    expect(req).toMatchObject({
      name: 'Builder',
      description: 'Code owner',
      runtime_id: 'claude-code',
      provider: 'openai',
      model: 'gpt-5.5',
      reasoning_effort: 'high',
      permission_mode: 'trusted',
      skills: '["Review","Security"]',
      tool_allowlist: '["Read"]',
    });
  });

  it('does not write display fallback labels back to Hub on update', () => {
    const req = agentConfigToUpdateAgentProfileRequest({
      id: 'agent-profile-1',
      name: 'Hub Agent',
      role: 'Hub owner scope',
      engine: 'Hub AgentProfile',
      model: '未配置模型',
      mode: 'Hub 默认策略',
      approval: 'Hub 默认策略',
      scope: 'Hub owner scope',
      state: 'ready',
      skills: [],
      tools: {},
    });

    expect(req).toMatchObject({
      name: 'Hub Agent',
    });
    expect(req).not.toHaveProperty('description');
    expect(req).not.toHaveProperty('runtime_id');
    expect(req).not.toHaveProperty('permission_mode');
    expect(req).not.toHaveProperty('model');
    expect(req).not.toHaveProperty('provider');
  });

  it('strips Hub runtime display hints before persisting descriptions', () => {
    const req = agentConfigToUpdateAgentProfileRequest({
      id: 'agent-profile-2',
      name: 'Reviewer',
      role: 'Reviews risky patches - Runtime: codex - Model: openai/gpt-5.5',
      engine: 'codex',
      model: 'openai / gpt-5.5',
      mode: 'Reasoning high',
      approval: 'Hub 默认策略',
      scope: 'default',
      state: 'ready',
      skills: [],
      tools: {},
    });

    expect(req.description).toBe('Reviews risky patches');
  });
});
