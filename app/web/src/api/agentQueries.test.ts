import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '@/hooks/useAuth';
import { fetchAgentList, mapHubAgentProfileToAgentInfo } from './agentQueries';

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
      mcp_servers: '[{"name":"github"}]',
      version: 3,
    });

    expect(agent).toMatchObject({
      id: '00000000-0000-0000-0000-00000000c101',
      name: 'Reviewer',
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

  it('keeps the explicit preview fallback when there is no Hub token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchAgentList(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.items).toHaveLength(3);
    expect(res.items[0]?.name).toBe('Claude Code');
  });
});
