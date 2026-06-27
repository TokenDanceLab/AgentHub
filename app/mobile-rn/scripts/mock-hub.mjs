import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';

const requestedPort = Number.parseInt(process.env.AGENTHUB_MOBILE_MOCK_HUB_PORT ?? '8088', 10);
const host = process.env.AGENTHUB_MOBILE_MOCK_HUB_HOST ?? '127.0.0.1';
const runCheck = process.argv.includes('--check');

const snapshot = {
  threads: [
    {
      id: 'mock-mobile-workbench',
      title: 'AgentHub Mobile Workbench',
      subtitle: 'TokenDance 工作区：对话、任务、云文档和 Agent Profiles 正在统一校准。',
      initials: 'AH',
      avatarTone: 'brand',
      unread: 4,
      participantKind: 'group',
      status: 'running',
      statusDetail: 'Workspace review active',
      presenceLabel: 'Active workspace',
      lastActivity: '14:18',
      activeRunId: 'mock-run-mobile',
      reviewDensity: 'dense',
      evidenceCount: 18,
    },
    {
      id: 'mock-design-contract',
      title: 'AgentHub Design Contract',
      subtitle: '头像、状态、底栏、账号抽屉和高密度审查列表等待确认。',
      initials: 'DS',
      avatarTone: 'warning',
      unread: 1,
      participantKind: 'group',
      status: 'waiting',
      statusDetail: 'Visual QA queued',
      presenceLabel: 'Activity queued',
      lastActivity: '12:15',
      reviewDensity: 'critical',
      evidenceCount: 12,
    },
    {
      id: 'mock-agent-profiles',
      title: 'Agent Profiles',
      subtitle: 'AgentHub Profile、工具权限和模型路由保持 Desktop 同一套语义。',
      initials: 'AP',
      avatarTone: 'accent',
      unread: 0,
      muted: true,
      participantKind: 'agent',
      status: 'online',
      statusDetail: '4 profiles ready',
      presenceLabel: 'Profiles ready',
      lastActivity: '昨天',
      reviewDensity: 'normal',
      evidenceCount: 7,
    },
    {
      id: 'mock-docs',
      title: 'AgentHub Docs',
      subtitle: '任务证据、项目文档和知识库已进入云文档视图。',
      initials: 'D',
      avatarTone: 'success',
      unread: 0,
      participantKind: 'bot',
      status: 'online',
      statusDetail: 'Docs synced',
      presenceLabel: 'Docs synced',
      lastActivity: '6月8日',
      reviewDensity: 'light',
      evidenceCount: 5,
    },
    {
      id: 'mock-tokendance-id',
      title: 'TokenDance ID',
      subtitle: '身份、设备和通知状态只在账号面板展示，不进入聊天消息流。',
      initials: 'TD',
      avatarTone: 'warning',
      unread: 2,
      participantKind: 'bot',
      status: 'waiting',
      statusDetail: 'Session review',
      presenceLabel: 'Needs attention',
      lastActivity: '6月7日',
      reviewDensity: 'critical',
      evidenceCount: 3,
    },
    {
      id: 'mock-task-activity-triage',
      title: '任务动态整理',
      subtitle: '任务动态按项目、证据和风险合并为移动端可扫读列表。',
      initials: 'RQ',
      avatarTone: 'accent',
      unread: 0,
      participantKind: 'group',
      status: 'running',
      statusDetail: 'Queue aligned',
      presenceLabel: 'Triage active',
      lastActivity: '6月6日',
      reviewDensity: 'normal',
      evidenceCount: 9,
    },
    {
      id: 'mock-model-routing',
      title: '模型路由策略',
      subtitle: '模型路由、fallback 和工具权限作为 Agent 配置展示。',
      initials: 'MR',
      avatarTone: 'neutral',
      unread: 0,
      muted: true,
      participantKind: 'agent',
      status: 'online',
      statusDetail: 'Policy visible',
      presenceLabel: 'Ready',
      lastActivity: '6月5日',
      reviewDensity: 'light',
      evidenceCount: 4,
    },
    {
      id: 'mock-workspace-evidence',
      title: '工作区证据审查',
      subtitle: '截图、diff、任务产物和云文档保持同一套 AgentHub 证据语义。',
      initials: 'WE',
      avatarTone: 'success',
      unread: 0,
      participantKind: 'bot',
      status: 'online',
      statusDetail: 'Evidence ready',
      presenceLabel: 'Ready',
      lastActivity: '6月4日',
      reviewDensity: 'light',
      evidenceCount: 11,
    },
  ],
  runs: [
    {
      id: 'mock-run-mobile',
      threadId: 'mock-mobile-workbench',
      title: 'AgentHub Mobile 工作台视觉校准',
      status: 'approval_required',
      target: 'app/mobile-rn',
      updatedAt: '14:16',
      summary: '对齐 Desktop v4、AgentHub Design Contract 和移动 IM 体验。',
      changedFiles: [
        'app/mobile-rn/src/api/hubClient.ts',
        'app/mobile-rn/src/api/hubEvents.ts',
        'app/mobile-rn/scripts/mock-hub.mjs',
      ],
      approvalRisk: 'medium',
      reviewDensity: 'normal',
      evidenceCount: 18,
      statusDetail: '设计系统进入移动端视觉审查。',
    },
  ],
  transcript: {
    'mock-mobile-workbench': [
      {
        id: 'mock-text-1',
        kind: 'text',
        author: { id: 'alice', name: 'Alice', role: 'human' },
        text: '把移动端聊天、任务和云文档整理成 AgentHub Desktop v4 同一套工作台语义。',
        createdAt: '14:02',
      },
      {
        id: 'mock-run-1',
        kind: 'run_session',
        author: { id: 'agenthub', name: 'AgentHub', role: 'agent' },
        title: 'AgentHub Mobile 工作台视觉校准',
        status: 'running',
        meta: '对齐 Desktop IA、移动 IM 密度和视觉 QA',
        runId: 'mock-run-mobile',
        createdAt: '14:06',
      },
      {
        id: 'mock-approval-1',
        kind: 'approval',
        author: { id: 'agenthub', name: 'AgentHub', role: 'agent' },
        title: '审查 AgentHub Mobile 工作台视觉校准',
        status: 'pending',
        risk: 'medium',
        reason: '确认移动端设计系统、组件语义和本地预览链路符合 AgentHub 工作台边界。',
        createdAt: '14:12',
      },
      {
        id: 'mock-diff-1',
        kind: 'diff',
        author: { id: 'agenthub', name: 'AgentHub', role: 'agent' },
        title: 'AgentHub token 与 RN primitive 对齐',
        files: ['app/mobile-rn/src/theme/tokens.ts', 'app/mobile-rn/src/components/primitives/Button.tsx'],
        additions: 312,
        deletions: 0,
        lines: [
          { type: 'add', content: '+ export const agentHubThemes = {' },
          { type: 'add', content: '+ export function Button({ label, loading, disabled }) {' },
          { type: 'ctx', content: '  // RN-safe primitives only' },
        ],
        createdAt: '14:16',
      },
    ],
    'mock-design-contract': [],
    'mock-agent-profiles': [],
    'mock-docs': [],
    'mock-tokendance-id': [],
    'mock-review-queue-triage': [],
    'mock-model-routing': [],
    'mock-workspace-evidence': [],
  },
  account: {
    tokenDanceId: 'signed_in',
    hubSession: 'active',
    notification: 'granted',
    hubSync: 'active',
    deviceLabel: 'TokenDance mobile preview',
  },
};

const eventFrames = [
  {
    id: 'evt-local-snapshot',
    type: 'snapshot.updated',
    createdAt: new Date().toISOString(),
    payload: { source: 'agenthub-mobile-rn mock hub' },
  },
  {
    id: 'evt-local-run',
    type: 'run.updated',
    createdAt: new Date().toISOString(),
    payload: { runId: 'mock-run-mobile', status: 'approval_required' },
  },
];

async function main() {
  const server = createServer(handleRequest);

  server.on('upgrade', handleUpgrade);

  const port = runCheck ? 0 : requestedPort;
  await listen(server, port);

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;

  if (runCheck) {
    try {
      await checkHttp(baseUrl);
      await checkWebSocket(actualPort);
      console.log(`AgentHub Mobile mock Hub check passed at ${baseUrl}`);
    } finally {
      await close(server);
    }
    return;
  }

  console.log(`AgentHub Mobile mock Hub listening at ${baseUrl}`);
  console.log(`Android emulator base URL: http://10.0.2.2:${actualPort}`);
  console.log('REST: GET /health, GET /v1/mobile/snapshot, GET /v1/threads, GET /client/sessions, GET /client/contacts');
  console.log('WS:   GET /v1/events, GET /client/ws');
}

function handleRequest(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${requestedPort}`}`);

  if (request.method === 'OPTIONS') {
    writeCorsNoContent(response);
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) {
    writeJson(response, 200, {
      ok: true,
      service: 'agenthub-mobile-rn-mock-hub',
      now: new Date().toISOString(),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/mobile/snapshot') {
    writeJson(response, 200, snapshot);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/threads') {
    writeJson(response, 200, { threads: snapshot.threads });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/client/sessions') {
    writeJson(response, 200, {
      code: 'OK',
      data: buildClientSessions(),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/client/contacts') {
    writeJson(response, 200, {
      code: 'OK',
      data: buildClientContacts(),
    });
    return;
  }

  writeJson(response, 404, {
    error: {
      code: 'not_found',
      message: 'AgentHub Mobile mock Hub route not found',
    },
  });
}

function handleUpgrade(request, socket) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${requestedPort}`}`);

  if (url.pathname !== '/v1/events' && url.pathname !== '/client/ws') {
    socket.destroy();
    return;
  }

  const key = request.headers['sec-websocket-key'];

  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }

  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'));

  for (const event of eventFrames) {
    socket.write(encodeTextFrame(JSON.stringify(event)));
  }
}

function buildClientSessions() {
  return snapshot.threads.map((thread, index) => ({
    session_id: thread.id,
    id: thread.id,
    type: thread.participantKind === 'group' ? 'group' : 'private',
    name: thread.title,
    unread_count: thread.unread,
    muted: thread.muted ?? false,
    updated_at: thread.lastActivity,
    last_message_at: thread.lastActivity,
    last_message: {
      message_id: `mock-message-${index + 1}`,
      content: thread.subtitle,
      content_type: 'text',
      created_at: thread.lastActivity,
    },
  }));
}

function buildClientContacts() {
  return [
    {
      user_id: 'alice',
      display_name: 'Delicious233',
      remark: 'AgentHub workspace owner',
      status: 'online',
    },
    {
      user_id: 'agenthub',
      display_name: 'AgentHub',
      remark: 'Workspace automation',
      status: 'online',
    },
  ];
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text);

  if (payload.length > 125) {
    const frame = Buffer.alloc(4);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(payload.length, 2);
    return Buffer.concat([frame, payload]);
  }

  const frame = Buffer.alloc(2);
  frame[0] = 0x81;
  frame[1] = payload.length;
  return Buffer.concat([frame, payload]);
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

function writeCorsNoContent(response) {
  response.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '600',
  });
  response.end();
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function checkHttp(baseUrl) {
  const health = await fetch(`${baseUrl}/health`);
  const body = await health.json();

  if (!health.ok || body.ok !== true) {
    throw new Error('Mock Hub health check failed');
  }

  const snapshotResponse = await fetch(`${baseUrl}/v1/mobile/snapshot`);
  const snapshotBody = await snapshotResponse.json();

  if (!snapshotResponse.ok || !Array.isArray(snapshotBody.threads) || snapshotBody.threads.length === 0) {
    throw new Error('Mock Hub snapshot check failed');
  }

  for (const pathname of ['/client/sessions', '/client/contacts']) {
    const preflight = await fetch(`${baseUrl}${pathname}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:5177',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    if (!preflight.ok || preflight.headers.get('access-control-allow-origin') !== '*') {
      throw new Error(`Mock Hub CORS preflight check failed for ${pathname}`);
    }

    const response = await fetch(`${baseUrl}${pathname}`);
    const responseBody = await response.json();

    if (!response.ok || responseBody.code !== 'OK' || !Array.isArray(responseBody.data)) {
      throw new Error(`Mock Hub client route check failed for ${pathname}`);
    }
  }
}

function checkWebSocket(port) {
  return new Promise((resolve, reject) => {
    const key = Buffer.from('AgentHub Mobile local check').toString('base64').slice(0, 24);
    const socket = connect(port, host);
    let response = '';

    socket.setTimeout(3000);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Mock Hub event check timed out'));
    });
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      response += chunk.toString('binary');
      if (response.includes('101 Switching Protocols') && response.includes('evt-local-snapshot')) {
        socket.end();
        resolve();
      }
    });
    socket.once('connect', () => {
      socket.write([
        'GET /client/ws HTTP/1.1',
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
