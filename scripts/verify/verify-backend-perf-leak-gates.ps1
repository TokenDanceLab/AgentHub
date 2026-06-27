param(
    [string]$Benchtime = "100ms",
    [switch]$SkipBenchmarks,
    [switch]$IncludeNoisyAgentTeamBenchmark
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
$HubRoot = Join-Path $RepoRoot "hub-server"
$EdgeRoot = Join-Path $RepoRoot "edge-server"

function Invoke-Step {
    param(
        [string]$Name,
        [string]$WorkDir,
        [string[]]$GoArgs
    )

    Write-Host "== $Name ==" -ForegroundColor Cyan
    Push-Location $WorkDir
    try {
        & go @GoArgs
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

Invoke-Step "Hub EventBus/outbox/OIDC TTL behavior" $HubRoot @(
    "test", "./internal/service",
    "-run", "TestBus|TestOutbox|TestGenerateAuthorizationURL|TestHandleCallback_(StateExpired|RejectsStaleStateEntryBeforeTokenExchange)",
    "-short", "-count=1"
)

Invoke-Step "Hub scheduler/rate-limit/WS behavior" $HubRoot @(
    "test", "./internal/app", "./internal/middleware", "./internal/ws",
    "-run", "Test(PublishExpiredTaskTimeout|AdminMuxRequiresBasicAuthForMetricsAndPprof|AdminListenAddrUsesLoopback|GlobalRateLimit|RateLimit|WSIPRateLimit|WSUserConnLimiter|Manager|Frame)",
    "-short", "-count=1"
)

Invoke-Step "Edge events/lifecycle/store/adapters behavior" $EdgeRoot @(
    "test", "./internal/events", "./internal/lifecycle", "./internal/store", "./internal/adapters",
    "-run", "Test(Bus|ProcessExecutor(StartCancelRace|TooManyConcurrentRuns|ContextCancellationMidRun|StartWithRunTimeoutCancelsSlowRun)|ResultAggregator|SQLite|Store|SDKAdapterLatencyBaseline)",
    "-short", "-count=1"
)

if (-not $SkipBenchmarks) {
    Invoke-Step "Edge microbenchmarks" $EdgeRoot @(
        "test", "./internal/events", "./internal/adapters", "./internal/lifecycle",
        "-run", "^$",
        "-bench", "Benchmark(Bus|SDKAdapterLatency|ClassifyComplexity|SanitizeSubAgentResult)",
        "-benchtime=$Benchtime",
        "-count=1"
    )

    Invoke-Step "Hub microbenchmarks" $HubRoot @(
        "test", "./internal/service", "./internal/ws", "./internal/jwtutil",
        "-run", "^$",
        "-bench", "Benchmark(EventBus|Frame|Generate|Parse|JWT|KeyManager|HashRefreshToken)",
        "-benchtime=$Benchtime",
        "-count=1"
    )

    if ($IncludeNoisyAgentTeamBenchmark) {
        Invoke-Step "Hub AgentTeam noisy microbenchmark" $HubRoot @(
            "test", "./internal/service/agentteam",
            "-run", "^$",
            "-bench", "BenchmarkRouteDecision",
            "-benchtime=$Benchtime",
            "-count=1"
        )
    }
}

Write-Host "backend perf/leak gate bundle ok" -ForegroundColor Green
Write-Host "Evidence boundary: behavior gates and microbenchmarks passed; pprof/leak and production capacity are not proven by this script." -ForegroundColor Yellow
