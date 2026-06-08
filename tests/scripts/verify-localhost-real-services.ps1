[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Failed = 0
$StartedProcesses = @()
$TempRoots = @()

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Condition) {
        Write-Host "PASS: $Message" -ForegroundColor Green
        return
    }

    $script:Failed++
    Write-Host "FAIL: $Message" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host $Details
    }
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

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "powershell"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + (Join-NativeArguments $Arguments)

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    try {
        return $listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function Start-FakeLocalhostServices {
    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-real-services-test-$PID-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
    $script:TempRoots += $tmpRoot
    $nodeScript = Join-Path $tmpRoot "fake-services.cjs"

    $nodeSource = @'
const http = require("node:http");

const services = {
  web: { path: "/healthz", marker: "agenthub-web-real-service-marker", contentType: "text/plain" },
  hub: { path: "/health/live", marker: '{"status":"ok","service":"agenthub-hub-real-service-marker"}', contentType: "application/json" },
  desktop: { path: "/bridge/health", marker: "agenthub-desktop-bridge-real-service-marker", contentType: "text/plain" },
  edge: { path: "/v1/health", marker: '{"status":"ok","version":"v1","service":"agenthub-local-edge-real-service-marker"}', contentType: "application/json" },
};

async function start(name, descriptor) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === descriptor.path) {
      res.writeHead(200, {
        "Content-Type": descriptor.contentType,
        "Content-Length": Buffer.byteLength(descriptor.marker),
      });
      res.end(descriptor.marker);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { name, url: `http://127.0.0.1:${address.port}`, server };
}

(async () => {
  const started = await Promise.all(Object.entries(services).map(([name, descriptor]) => start(name, descriptor)));
  const urls = {};
  for (const service of started) {
    urls[service.name] = service.url;
  }
  process.stdout.write(`${JSON.stringify(urls)}\n`);
  process.stdin.resume();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
'@
    Set-Content -LiteralPath $nodeScript -Value $nodeSource -Encoding UTF8

    $node = Get-Command node -ErrorAction Stop
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $node.Source
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $tmpRoot
    $psi.Arguments = Join-NativeArguments @($nodeScript)

    $proc = [System.Diagnostics.Process]::Start($psi)
    $script:StartedProcesses += $proc
    $line = $proc.StandardOutput.ReadLine()
    if ([string]::IsNullOrWhiteSpace($line)) {
        throw "fake localhost services did not report URLs: $($proc.StandardError.ReadToEnd())"
    }
    $urls = $line | ConvertFrom-Json
    return [pscustomobject]@{
        Process = $proc
        Urls = $urls
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-localhost-real-services.ps1"
Assert-True (Test-Path -LiteralPath $scriptPath) "real localhost services harness exists"

try {
    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-real-services-test-$PID"
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
    $TempRoots += $tmpRoot

    if (Test-Path -LiteralPath $scriptPath) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptPath
        foreach ($markerParam in @("ExpectedWebMarker", "ExpectedHubMarker", "ExpectedDesktopMarker", "ExpectedEdgeMarker")) {
            Assert-True ($scriptText -match "\[string\]\`$$markerParam = `"`"") "$markerParam defaults to empty and must be caller-supplied"
        }
        Assert-True ($scriptText -match "operator_attested_start_plan_not_verified_by_harness") "StartServices spend claim is operator-attested"
        Assert-True ($scriptText -match "RealTested is always false") "script documents readiness-only RealTested boundary"

        $noOptEvidence = Join-Path $tmpRoot "no-opt-in.json"
        $noOpt = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $noOptEvidence
        )
        Assert-True ($noOpt.ExitCode -eq 2) "harness blocks by default without -RealServices" $noOpt.Output
        Assert-True ($noOpt.Output -match "Real services opt-in required") "default block names required opt-in" $noOpt.Output
        $noOptJson = Get-Content -Raw -LiteralPath $noOptEvidence | ConvertFrom-Json
        Assert-True ($noOptJson.real_tested -eq $false) "default block keeps RealTested false" ($noOptJson | ConvertTo-Json -Depth 6)

        $missingPort = Get-FreePort
        $missingEvidence = Join-Path $tmpRoot "missing-service.json"
        $missingRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $missingEvidence,
            "-RealServices",
            "-WebUrl", "http://127.0.0.1:$missingPort",
            "-HubUrl", "http://127.0.0.1:$missingPort",
            "-DesktopBridgeUrl", "http://127.0.0.1:$missingPort",
            "-LocalEdgeUrl", "http://127.0.0.1:$missingPort",
            "-TimeoutSec", "1",
            "-ExpectedWebMarker", "agenthub-web-real-service-marker",
            "-ExpectedHubMarker", "agenthub-hub-real-service-marker",
            "-ExpectedDesktopMarker", "agenthub-desktop-bridge-real-service-marker",
            "-ExpectedEdgeMarker", "agenthub-local-edge-real-service-marker",
            "-RegisteredTargetUrl", "http://127.0.0.1:$missingPort",
            "-HubDispatchTargetUrl", "http://127.0.0.1:$missingPort"
        )
        Assert-True ($missingRun.ExitCode -ne 0) "missing services fail the real-services harness" $missingRun.Output
        Assert-True ($missingRun.Output -match "missing service") "missing service failure is explicit" $missingRun.Output
        $missingJson = Get-Content -Raw -LiteralPath $missingEvidence | ConvertFrom-Json
        Assert-True ($missingJson.real_tested -eq $false) "missing service evidence keeps RealTested false" ($missingJson | ConvertTo-Json -Depth 6)

        $fake = Start-FakeLocalhostServices
        $urls = $fake.Urls

        $passEvidence = Join-Path $tmpRoot "real-services-pass.json"
        $passRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $passEvidence,
            "-RealServices",
            "-WebUrl", $urls.web,
            "-HubUrl", $urls.hub,
            "-DesktopBridgeUrl", $urls.desktop,
            "-LocalEdgeUrl", $urls.edge,
            "-WebHealthPath", "/healthz",
            "-HubHealthPath", "/health/live",
            "-DesktopHealthPath", "/bridge/health",
            "-EdgeHealthPath", "/v1/health",
            "-ExpectedWebMarker", "agenthub-web-real-service-marker",
            "-ExpectedHubMarker", "agenthub-hub-real-service-marker",
            "-ExpectedDesktopMarker", "agenthub-desktop-bridge-real-service-marker",
            "-ExpectedEdgeMarker", "agenthub-local-edge-real-service-marker",
            "-RegisteredTargetUrl", $urls.desktop,
            "-HubDispatchTargetUrl", $urls.desktop
        )
        Assert-True ($passRun.ExitCode -eq 0) "healthy marked services pass readiness-only probe" $passRun.Output
        Assert-True ($passRun.Output -match "READINESS_ONLY_PASSED") "successful probe reports readiness-only status" $passRun.Output
        Assert-True ($passRun.Output -match "RealTested=false") "successful readiness probe does not claim RealTested" $passRun.Output
        $passJson = Get-Content -Raw -LiteralPath $passEvidence | ConvertFrom-Json
        Assert-True ($passJson.mode -eq "ReadinessOnly") "healthy explicit probe records ReadinessOnly mode" ($passJson | ConvertTo-Json -Depth 8)
        Assert-True ($passJson.real_tested -eq $false) "healthy explicit probe keeps RealTested false" ($passJson | ConvertTo-Json -Depth 8)
        Assert-True ($passJson.real_dispatch_proof_required -eq $true) "healthy explicit probe records separate real dispatch proof requirement" ($passJson | ConvertTo-Json -Depth 8)
        Assert-True ($passJson.topology.hub.dispatch_target_url -eq $urls.desktop) "evidence records Hub dispatch target URL" ($passJson | ConvertTo-Json -Depth 8)

        $missingMarkerEvidence = Join-Path $tmpRoot "missing-marker.json"
        $missingMarkerRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $missingMarkerEvidence,
            "-RealServices",
            "-WebUrl", $urls.web,
            "-HubUrl", $urls.hub,
            "-DesktopBridgeUrl", $urls.desktop,
            "-LocalEdgeUrl", $urls.edge,
            "-WebHealthPath", "/healthz",
            "-HubHealthPath", "/health/live",
            "-DesktopHealthPath", "/bridge/health",
            "-EdgeHealthPath", "/v1/health",
            "-RegisteredTargetUrl", $urls.desktop,
            "-HubDispatchTargetUrl", $urls.desktop
        )
        Assert-True ($missingMarkerRun.ExitCode -ne 0) "missing expected markers fail the readiness harness" $missingMarkerRun.Output
        Assert-True ($missingMarkerRun.Output -match "expected identity marker missing") "missing marker failure is explicit" $missingMarkerRun.Output
        $missingMarkerJson = Get-Content -Raw -LiteralPath $missingMarkerEvidence | ConvertFrom-Json
        Assert-True ($missingMarkerJson.real_tested -eq $false) "missing marker evidence keeps RealTested false" ($missingMarkerJson | ConvertTo-Json -Depth 8)

        $wrongMarkerEvidence = Join-Path $tmpRoot "wrong-marker.json"
        $wrongMarkerRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $wrongMarkerEvidence,
            "-RealServices",
            "-WebUrl", $urls.web,
            "-HubUrl", $urls.hub,
            "-DesktopBridgeUrl", $urls.desktop,
            "-LocalEdgeUrl", $urls.edge,
            "-WebHealthPath", "/healthz",
            "-HubHealthPath", "/health/live",
            "-DesktopHealthPath", "/bridge/health",
            "-EdgeHealthPath", "/v1/health",
            "-ExpectedWebMarker", "not-the-web-marker",
            "-ExpectedHubMarker", "agenthub-hub-real-service-marker",
            "-ExpectedDesktopMarker", "agenthub-desktop-bridge-real-service-marker",
            "-ExpectedEdgeMarker", "agenthub-local-edge-real-service-marker",
            "-RegisteredTargetUrl", $urls.desktop,
            "-HubDispatchTargetUrl", $urls.desktop
        )
        Assert-True ($wrongMarkerRun.ExitCode -ne 0) "wrong identity marker fails the real-services harness" $wrongMarkerRun.Output
        Assert-True ($wrongMarkerRun.Output -match "web identity marker mismatch") "wrong marker failure names web marker mismatch" $wrongMarkerRun.Output
        $wrongMarkerJson = Get-Content -Raw -LiteralPath $wrongMarkerEvidence | ConvertFrom-Json
        Assert-True ($wrongMarkerJson.real_tested -eq $false) "wrong marker evidence keeps RealTested false" ($wrongMarkerJson | ConvertTo-Json -Depth 8)

        $targetMismatchEvidence = Join-Path $tmpRoot "target-mismatch.json"
        $targetMismatchRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $targetMismatchEvidence,
            "-RealServices",
            "-WebUrl", $urls.web,
            "-HubUrl", $urls.hub,
            "-DesktopBridgeUrl", $urls.desktop,
            "-LocalEdgeUrl", $urls.edge,
            "-WebHealthPath", "/healthz",
            "-HubHealthPath", "/health/live",
            "-DesktopHealthPath", "/bridge/health",
            "-EdgeHealthPath", "/v1/health",
            "-ExpectedWebMarker", "agenthub-web-real-service-marker",
            "-ExpectedHubMarker", "agenthub-hub-real-service-marker",
            "-ExpectedDesktopMarker", "agenthub-desktop-bridge-real-service-marker",
            "-ExpectedEdgeMarker", "agenthub-local-edge-real-service-marker",
            "-RegisteredTargetUrl", $urls.desktop,
            "-HubDispatchTargetUrl", $urls.edge
        )
        Assert-True ($targetMismatchRun.ExitCode -ne 0) "target URL mismatch fails the real-services harness" $targetMismatchRun.Output
        Assert-True ($targetMismatchRun.Output -match "target URL mismatch") "target mismatch failure is explicit" $targetMismatchRun.Output
        $targetMismatchJson = Get-Content -Raw -LiteralPath $targetMismatchEvidence | ConvertFrom-Json
        Assert-True ($targetMismatchJson.real_tested -eq $false) "target mismatch evidence keeps RealTested false" ($targetMismatchJson | ConvertTo-Json -Depth 8)

        $callerFakeEvidence = Join-Path $tmpRoot "caller-fake-values.json"
        $callerFakeRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $callerFakeEvidence,
            "-RealServices",
            "-WebUrl", $urls.web,
            "-HubUrl", $urls.hub,
            "-DesktopBridgeUrl", $urls.desktop,
            "-LocalEdgeUrl", $urls.edge,
            "-WebHealthPath", "/healthz",
            "-HubHealthPath", "/health/live",
            "-DesktopHealthPath", "/bridge/health",
            "-EdgeHealthPath", "/v1/health",
            "-ExpectedWebMarker", "agenthub-web-real-service-marker",
            "-ExpectedHubMarker", "agenthub-hub-real-service-marker",
            "-ExpectedDesktopMarker", "agenthub-desktop-bridge-real-service-marker",
            "-ExpectedEdgeMarker", "agenthub-local-edge-real-service-marker",
            "-RegisteredTargetUrl", $urls.desktop,
            "-HubDispatchTargetUrl", $urls.desktop
        )
        Assert-True ($callerFakeRun.ExitCode -eq 0) "caller-supplied matching fake values can only pass readiness" $callerFakeRun.Output
        $callerFakeJson = Get-Content -Raw -LiteralPath $callerFakeEvidence | ConvertFrom-Json
        Assert-True ($callerFakeJson.real_tested -eq $false) "caller-supplied matching fake values cannot set RealTested true" ($callerFakeJson | ConvertTo-Json -Depth 8)
        Assert-True ($callerFakeJson.status -eq "READINESS_ONLY_PASSED") "caller-supplied matching fake values are labeled readiness-only" ($callerFakeJson | ConvertTo-Json -Depth 8)
    }
}
finally {
    foreach ($proc in $StartedProcesses) {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    foreach ($path in $TempRoots) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
