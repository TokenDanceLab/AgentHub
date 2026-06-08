#!/usr/bin/env pwsh
<#
AgentHub localhost product-loop fixture harness.

This starts localhost-only fixture HTTP services for Web, Hub, Desktop bridge,
and Local Edge, then proves this sequence:

Web -> Hub -> registered Desktop/Edge -> Local Edge -> fixture/SDK adapter -> Hub replay

Boundary:
- no real TokenDanceID or browser secrets
- no real CLI/model/runtime spend
- no public deploy, signing, release upload, or mobile path
- RealTested=false
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$EvidencePath = "",
    [string]$NodePath = "node",
    [ValidateSet("", "WrongDesktopUrl", "MissingDesktopUrl", "NonLocalhostDesktopUrl", "ForgedCallback", "MissingIdentityMarker", "RealTestedOverclaim")]
    [string]$FaultMode = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath

if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-localhost-product-loop-$PID.json"
}

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Join-NativeArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            '""'
            continue
        }
        if ($arg -notmatch '[\s"]' -and $arg.Length -gt 0) {
            $arg
            continue
        }

        $builder = [System.Text.StringBuilder]::new()
        [void]$builder.Append('"')
        $slashes = 0
        foreach ($char in $arg.ToCharArray()) {
            if ($char -eq '\') {
                $slashes++
                continue
            }
            if ($char -eq '"') {
                [void]$builder.Append(('\' * (($slashes * 2) + 1)))
                [void]$builder.Append('"')
                $slashes = 0
                continue
            }
            if ($slashes -gt 0) {
                [void]$builder.Append(('\' * $slashes))
                $slashes = 0
            }
            [void]$builder.Append($char)
        }
        if ($slashes -gt 0) {
            [void]$builder.Append(('\' * ($slashes * 2)))
        }
        [void]$builder.Append('"')
        $builder.ToString()
    }

    return ($quoted -join " ")
}

function Invoke-CapturedProcess {
    param(
        [string]$FileName,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.Arguments = Join-NativeArguments $Arguments

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + $stderr)
    }
}

$node = Get-Command $NodePath -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "BLOCKED: node executable was not found; localhost fixture services were not started." -ForegroundColor Yellow
    Write-Host "RealTested=false" -ForegroundColor White
    exit 2
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-localhost-product-loop-$PID"
Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$nodeScript = Join-Path $tempRoot "localhost-product-loop.cjs"

$nodeSource = @'
const http = require("node:http");
const fs = require("node:fs");

const evidencePath = process.argv[2];
const repoRoot = process.argv[3];
const faultMode = process.argv[4] || "";
const startedAt = new Date().toISOString();

const ids = {
  teamRunId: "teamrun-localhost-fixture-001",
  hubTaskId: "task-localhost-fixture-001",
  targetId: "target-localhost-desktop-edge-001",
  edgeDeviceId: "desktop-edge-localhost-001",
  edgeRunId: "edge-run-localhost-fixture-001",
  adapterId: "fixture-sdk-adapter",
};

const urls = {};
const servers = [];
const events = [];
const tasks = [];
const negativeChecks = [];
const targets = new Map();

function log(text) {
  process.stdout.write(`${text}\n`);
}

function record(type, actor, fields = {}) {
  const event = {
    id: `evt-local-${String(events.length + 1).padStart(3, "0")}`,
    type,
    actor,
    team_run_id: ids.teamRunId,
    at: new Date().toISOString(),
    ...fields,
  };
  events.push(event);
  return event;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function requestJson(method, url, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(url, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload,
  });
  const text = await response.text();
  let parsed = {};
  if (text.trim()) {
    parsed = JSON.parse(text);
  }
  if (!response.ok) {
    throw new Error(`${method} ${url} failed ${response.status}: ${text}`);
  }
  return parsed;
}

async function expectRejectedJson(method, url, body, label) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(url, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload,
  });
  const text = await response.text();
  let parsed = {};
  if (text.trim()) {
    parsed = JSON.parse(text);
  }
  if (response.ok) {
    throw new Error(`${label} was accepted unexpectedly: ${text}`);
  }
  negativeChecks.push({
    label,
    status: response.status,
    error: parsed.error || text,
  });
  return parsed;
}

function isLocalhostHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function serviceHealth(service, applyFault = true) {
  const health = {
    web: {
      service: "web",
      status: "ok",
      identity: "agenthub-web-localhost-fixture",
      upstream: "hub-only",
    },
    hub: {
      service: "hub",
      status: "ok",
      identity: "agenthub-hub-localhost-fixture",
      upstream: "registered-desktop-target-router",
    },
    desktop: {
      service: "desktop",
      status: "ok",
      identity: "agenthub-desktop-bridge-localhost-fixture",
      bridge: "tauri-sidecar-fixture",
    },
    "local-edge": {
      service: "local-edge",
      status: "ok",
      identity: "agenthub-local-edge-localhost-fixture",
      adapter: "fixture-sdk",
      runner: "fixture-local-edge-runner",
    },
  }[service];
  if (!health) {
    throw new Error(`unknown service health fixture ${service}`);
  }
  if (applyFault && faultMode === "MissingIdentityMarker" && service === "web") {
    delete health.identity;
  }
  return health;
}

function createService(service, handler) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      writeJson(res, 500, { error: error.message, service });
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      urls[service] = `http://127.0.0.1:${address.port}`;
      resolve(server);
    });
  });
}

async function startHub() {
  await createService("hub", async (req, res) => {
    const route = new URL(req.url, urls.hub);
    if (req.method === "GET" && route.pathname === "/health") {
      writeJson(res, 200, serviceHealth("hub"));
      return;
    }

    if (req.method === "POST" && route.pathname === "/api/targets/register") {
      const body = await readJson(req);
      if (body.targetId !== ids.targetId || body.edgeDeviceId !== ids.edgeDeviceId) {
        writeJson(res, 400, { error: "unexpected target registration" });
        return;
      }
      if (!isLocalhostHttpUrl(body.desktopUrl)) {
        writeJson(res, 400, { error: "desktopUrl must be a localhost http URL" });
        return;
      }
      targets.set(body.targetId, body);
      record("target.registered", "orchestrator", {
        target_id: body.targetId,
        edge_device_id: body.edgeDeviceId,
        desktop_url: body.desktopUrl,
        registration_mode: "localhost-fixture-seed",
      });
      writeJson(res, 200, { status: "registered", targetId: body.targetId });
      return;
    }

    if (req.method === "POST" && route.pathname === "/api/teamruns") {
      const body = await readJson(req);
      const target = targets.get(body.targetId);
      if (!target) {
        writeJson(res, 404, { error: "target is not registered" });
        return;
      }
      const task = {
        id: ids.hubTaskId,
        team_run_id: ids.teamRunId,
        status: "dispatching",
        target_id: ids.targetId,
        edge_device_id: ids.edgeDeviceId,
        edge_run_id: "",
        adapter_id: "",
        expected_callback_type: "adapter.run.completed",
        expected_edge_run_id: ids.edgeRunId,
        expected_adapter_id: ids.adapterId,
      };
      tasks.push(task);
      record("hub.agent.dispatch", "hub", {
        target_id: ids.targetId,
        edge_device_id: ids.edgeDeviceId,
        hub_task_id: ids.hubTaskId,
        desktop_url: target.desktopUrl,
      });
      await requestJson("POST", `${target.desktopUrl}/dispatch`, {
        teamRunId: ids.teamRunId,
        hubTaskId: ids.hubTaskId,
        targetId: ids.targetId,
        edgeDeviceId: ids.edgeDeviceId,
        hubCallbackUrl: `${urls.hub}/api/events`,
      });
      writeJson(res, 200, { status: "dispatched", hubTaskId: ids.hubTaskId });
      return;
    }

    if (req.method === "POST" && route.pathname === "/api/events") {
      const body = await readJson(req);
      const task = tasks.find((item) => item.id === body.hubTaskId);
      if (!task) {
        writeJson(res, 400, { error: "callback hubTaskId has no in-flight run" });
        return;
      }
      if (task.status !== "dispatching") {
        writeJson(res, 409, { error: "callback order is invalid for task status" });
        return;
      }
      if (body.type !== task.expected_callback_type) {
        writeJson(res, 400, { error: "callback type does not match expected in-flight run" });
        return;
      }
      if (body.edgeRunId !== task.expected_edge_run_id) {
        writeJson(res, 400, { error: "callback edgeRunId does not match expected in-flight run" });
        return;
      }
      if (body.adapterId !== task.expected_adapter_id) {
        writeJson(res, 400, { error: "callback adapterId does not match expected in-flight run" });
        return;
      }
      task.status = "completed";
      task.edge_run_id = body.edgeRunId;
      task.adapter_id = body.adapterId;
      record("hub.replay.recorded", "hub", {
        target_id: ids.targetId,
        edge_device_id: ids.edgeDeviceId,
        edge_run_id: body.edgeRunId,
        adapter_id: body.adapterId,
        callback_type: body.type,
      });
      writeJson(res, 200, { status: "recorded" });
      return;
    }

    if (req.method === "GET" && route.pathname === `/api/replay/${ids.teamRunId}`) {
      writeJson(res, 200, {
        teamRunId: ids.teamRunId,
        targetId: ids.targetId,
        edgeDeviceId: ids.edgeDeviceId,
        events,
        tasks,
      });
      return;
    }

    writeJson(res, 404, { error: "not found", service: "hub" });
  });
}

async function startLocalEdge() {
  await createService("local-edge", async (req, res) => {
    const route = new URL(req.url, urls["local-edge"]);
    if (req.method === "GET" && route.pathname === "/health") {
      writeJson(res, 200, serviceHealth("local-edge"));
      return;
    }

    if (req.method === "POST" && route.pathname === "/runs") {
      const body = await readJson(req);
      record("edge.run.started", "local-edge", {
        target_id: body.targetId,
        edge_device_id: body.edgeDeviceId,
        edge_run_id: ids.edgeRunId,
        adapter_id: ids.adapterId,
      });

      if (faultMode === "ForgedCallback") {
        await requestJson("POST", body.hubCallbackUrl, {
          type: "adapter.run.started",
          hubTaskId: body.hubTaskId,
          edgeRunId: "forged-edge-run",
          adapterId: "forged-adapter",
        });
      }

      await expectRejectedJson("POST", body.hubCallbackUrl, {
        type: "adapter.run.completed",
        hubTaskId: "forged-hub-task",
        edgeRunId: ids.edgeRunId,
        adapterId: ids.adapterId,
      }, "forged hubTaskId callback");
      await expectRejectedJson("POST", body.hubCallbackUrl, {
        type: "adapter.run.started",
        hubTaskId: body.hubTaskId,
        edgeRunId: ids.edgeRunId,
        adapterId: ids.adapterId,
      }, "forged callback type");
      await expectRejectedJson("POST", body.hubCallbackUrl, {
        type: "adapter.run.completed",
        hubTaskId: body.hubTaskId,
        edgeRunId: "forged-edge-run",
        adapterId: ids.adapterId,
      }, "forged edgeRunId callback");
      await expectRejectedJson("POST", body.hubCallbackUrl, {
        type: "adapter.run.completed",
        hubTaskId: body.hubTaskId,
        edgeRunId: ids.edgeRunId,
        adapterId: "forged-adapter",
      }, "forged adapterId callback");

      record("adapter.run.completed", "fixture-sdk", {
        target_id: body.targetId,
        edge_device_id: body.edgeDeviceId,
        edge_run_id: ids.edgeRunId,
        adapter_id: ids.adapterId,
        real_cli_or_model_invoked: false,
      });
      await requestJson("POST", body.hubCallbackUrl, {
        type: "adapter.run.completed",
        hubTaskId: body.hubTaskId,
        edgeRunId: ids.edgeRunId,
        adapterId: ids.adapterId,
      });
      writeJson(res, 200, {
        status: "completed",
        edgeRunId: ids.edgeRunId,
        adapterId: ids.adapterId,
      });
      return;
    }

    writeJson(res, 404, { error: "not found", service: "local-edge" });
  });
}

async function startDesktop() {
  await createService("desktop", async (req, res) => {
    const route = new URL(req.url, urls.desktop);
    if (req.method === "GET" && route.pathname === "/health") {
      writeJson(res, 200, serviceHealth("desktop"));
      return;
    }

    if (req.method === "POST" && route.pathname === "/dispatch") {
      const body = await readJson(req);
      record("desktop.dispatch.accepted", "desktop", {
        target_id: body.targetId,
        edge_device_id: body.edgeDeviceId,
        hub_task_id: body.hubTaskId,
      });
      const edgeResult = await requestJson("POST", `${urls["local-edge"]}/runs`, {
        teamRunId: body.teamRunId,
        hubTaskId: body.hubTaskId,
        targetId: body.targetId,
        edgeDeviceId: body.edgeDeviceId,
        hubCallbackUrl: body.hubCallbackUrl,
      });
      writeJson(res, 200, { status: "accepted", edge: edgeResult });
      return;
    }

    writeJson(res, 404, { error: "not found", service: "desktop" });
  });
}

async function startWeb() {
  await createService("web", async (req, res) => {
    const route = new URL(req.url, urls.web);
    if (req.method === "GET" && route.pathname === "/health") {
      writeJson(res, 200, serviceHealth("web"));
      return;
    }

    if (req.method === "POST" && route.pathname === "/start") {
      record("web.teamrun.start", "web", {
        target_id: ids.targetId,
        source: "localhost-fixture-web",
      });
      const result = await requestJson("POST", `${urls.hub}/api/teamruns`, {
        teamRunId: ids.teamRunId,
        targetId: ids.targetId,
        source: "web",
      });
      writeJson(res, 200, { status: "started", hub: result });
      return;
    }

    writeJson(res, 404, { error: "not found", service: "web" });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function eventIndex(type) {
  return events.findIndex((event) => event.type === type);
}

function validateServiceIdentity(service, health) {
  const expected = serviceHealth(service, false);
  for (const [key, value] of Object.entries(expected)) {
    assert(health[key] === value, `${service} health identity marker mismatch for ${key}`);
  }
}

function validateReplay(replay) {
  const required = [
    "target.registered",
    "web.teamrun.start",
    "hub.agent.dispatch",
    "desktop.dispatch.accepted",
    "edge.run.started",
    "adapter.run.completed",
    "hub.replay.recorded",
  ];
  let lastIndex = -1;
  for (const type of required) {
    const index = eventIndex(type);
    assert(index > lastIndex, `event ${type} is not in product-loop order`);
    lastIndex = index;
  }
  assert(replay.tasks.length === 1, "Hub replay should contain one task");
  assert(replay.tasks[0].status === "completed", "Hub replay task should be completed");
  assert(replay.tasks[0].target_id === ids.targetId, "Hub replay task target_id mismatch");
  assert(replay.tasks[0].edge_device_id === ids.edgeDeviceId, "Hub replay task edge_device_id mismatch");
  assert(replay.tasks[0].edge_run_id === ids.edgeRunId, "Hub replay task edge_run_id mismatch");
  assert(replay.tasks[0].adapter_id === ids.adapterId, "Hub replay task adapter_id mismatch");
}

async function main() {
  log("AgentHub localhost product-loop harness");
  log("Sequence: Web -> Hub -> registered Desktop/Edge -> Local Edge -> fixture/SDK adapter -> Hub replay");
  log("RealTested=false");

  await startHub();
  await startLocalEdge();
  await startDesktop();
  await startWeb();

  const services = [
    { service: "web", url: urls.web, status: "started" },
    { service: "hub", url: urls.hub, status: "started" },
    { service: "desktop", url: urls.desktop, status: "started" },
    { service: "local-edge", url: urls["local-edge"], status: "started" },
  ];

  for (const service of services) {
    const health = await requestJson("GET", `${service.url}/health`);
    validateServiceIdentity(service.service, health);
    service.health = health;
  }

  log("PASS: localhost fixture services started with identity markers");

  const registration = {
    targetId: ids.targetId,
    edgeDeviceId: ids.edgeDeviceId,
    desktopUrl: urls.desktop,
    registrationMode: "localhost-fixture-seed",
  };
  if (faultMode === "WrongDesktopUrl") {
    registration.desktopUrl = urls["local-edge"];
  } else if (faultMode === "MissingDesktopUrl") {
    delete registration.desktopUrl;
  } else if (faultMode === "NonLocalhostDesktopUrl") {
    registration.desktopUrl = "https://example.com/desktop";
  }

  await requestJson("POST", `${urls.hub}/api/targets/register`, registration);
  log("PASS: Hub has registered Desktop/Edge target");

  await requestJson("POST", `${urls.web}/start`, {});
  const replay = await requestJson("GET", `${urls.hub}/api/replay/${ids.teamRunId}`);
  validateReplay(replay);
  await expectRejectedJson("POST", `${urls.hub}/api/events`, {
    type: "adapter.run.completed",
    hubTaskId: ids.hubTaskId,
    edgeRunId: ids.edgeRunId,
    adapterId: ids.adapterId,
  }, "duplicate callback order");

  log("PASS: Web starts TeamRun through Hub-only boundary");
  log("PASS: Hub routes to the registered Desktop/Edge target");
  log("PASS: Desktop bridge dispatches only to Local Edge");
  log("PASS: Local Edge runs fixture/SDK adapter without CLI/model spend");
  log("PASS: Hub rejects forged and out-of-order callbacks before replay");
  log("PASS: Hub replay records completed localhost fixture chain");

  const manifest = {
    hubTaskId: ids.hubTaskId,
    targetId: ids.targetId,
    edgeDeviceId: ids.edgeDeviceId,
    edgeRunId: ids.edgeRunId,
    adapterId: ids.adapterId,
    mode: "LocalhostFixture",
    startedAt,
    eventRefs: events.map((event) => `${event.actor}:${event.type}:${event.id}`),
    chain: [
      { stage: "target_registered", label: "Hub has registered Desktop/Edge target", eventRef: "orchestrator:target.registered:evt-local-001" },
      { stage: "web_start", label: "Web starts TeamRun through Hub-only boundary", eventRef: "web:web.teamrun.start:evt-local-002" },
      { stage: "hub_exact_route", label: "Hub routes to the registered Desktop/Edge target", eventRef: "hub:hub.agent.dispatch:evt-local-003" },
      { stage: "desktop_bridge_start", label: "Desktop bridge dispatches only to Local Edge", eventRef: "desktop:desktop.dispatch.accepted:evt-local-004" },
      { stage: "edge_events_callback", label: "Local Edge starts fixture run", eventRef: "local-edge:edge.run.started:evt-local-005" },
      { stage: "adapter_callback_result", label: "Local Edge runs fixture/SDK adapter without CLI/model spend", eventRef: "fixture-sdk:adapter.run.completed:evt-local-006" },
      { stage: "hub_replay", label: "Hub replay records completed localhost fixture chain", eventRef: "hub:hub.replay.recorded:evt-local-007" },
    ],
  };

  const evidence = {
    schema: "agenthub-localhost-product-loop-v1",
    mode: "LocalhostFixture",
    real_tested: false,
    generated_at: new Date().toISOString(),
    repo_root: repoRoot,
    sequence: "Web -> Hub -> registered Desktop/Edge -> Local Edge -> fixture/SDK adapter -> Hub replay",
    claims: {
      real_tokendance_id_login: false,
      real_cli_or_model_invoked: false,
      public_deploy_used: false,
      mobile_path_touched: false,
    },
    services,
    topology: {
      web: { allowed_upstreams: ["hub"] },
      hub: { routes_to: ["registered-desktop-edge-target"], replay_owner: true },
      desktop: { allowed_upstreams: ["local-edge"], bridge: "tauri-sidecar-fixture" },
      local_edge: { adapter: "fixture-sdk", real_cli_or_model_invoked: false },
    },
    remote_control_manifest: manifest,
    negative_checks: negativeChecks,
    tasks,
    events,
    blockers: [
      "real TokenDanceID login remains blocked",
      "real CLI/model adapter invocation remains blocked",
      "public deploy remains blocked",
    ],
  };
  if (faultMode === "RealTestedOverclaim") {
    evidence.real_tested = true;
  }

  fs.mkdirSync(require("node:path").dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  log(`EvidencePath: ${evidencePath}`);
}

main()
  .catch((error) => {
    process.stderr.write(`FAIL: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  });
'@

$nodeSource | Set-Content -LiteralPath $nodeScript -Encoding UTF8

Step "Localhost product-loop fixture"
$run = Invoke-CapturedProcess $node.Source @($nodeScript, $EvidencePath, $RepoRoot, $FaultMode) $RepoRoot
Write-Host $run.Output

if ($run.ExitCode -ne 0) {
    Write-Host "localhost product-loop harness failed. RealTested=false" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $EvidencePath)) {
    Write-Host "localhost product-loop harness failed: evidence file was not written. RealTested=false" -ForegroundColor Red
    exit 1
}

$evidence = Get-Content -Raw -LiteralPath $EvidencePath | ConvertFrom-Json
if ($evidence.real_tested -ne $false) {
    Write-Host "localhost product-loop harness failed: evidence must keep RealTested=false." -ForegroundColor Red
    exit 1
}

Step "Boundary summary"
Write-Host "  no real TokenDanceID login" -ForegroundColor White
Write-Host "  no real CLI/model adapter invocation" -ForegroundColor White
Write-Host "  no public deploy/signing/release upload" -ForegroundColor White
Write-Host "  RealTested=false" -ForegroundColor White

Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
exit 0
