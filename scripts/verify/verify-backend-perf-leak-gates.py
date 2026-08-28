#!/usr/bin/env python3
r"""Backend perf/leak gates — ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）。

行为门禁 + 短微基准（非生产容量）：依次运行 Hub/Edge 指定包的 -short 行为
测试与 -bench 微基准，任一步 go 子进程失败即整体失败（对齐 ps1 的
$ErrorActionPreference='Stop' + throw 语义）。证据边界固定文案：
pprof/leak 与生产容量不由本脚本证明。

CLI 兼容：--Benchtime（默认 100ms，同时接受 -Benchtime 单短横形式）、
--SkipBenchmarks、--IncludeNoisyAgentTeamBenchmark 与 ps1 同名。
"""

import argparse
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
HUB_ROOT = os.path.join(REPO_ROOT, "hub-server")
EDGE_ROOT = os.path.join(REPO_ROOT, "edge-server")


def invoke_step(name: str, work_dir: str, go_args: list) -> None:
    print(f"== {name} ==")
    result = subprocess.run(["go", *go_args], cwd=work_dir)
    if result.returncode != 0:
        raise RuntimeError(f"{name} failed with exit code {result.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Backend perf/leak gates")
    parser.add_argument("-Benchtime", "--Benchtime", default="100ms", help="go test -benchtime value (default 100ms)")
    parser.add_argument("--SkipBenchmarks", action="store_true", help="skip microbenchmark steps")
    parser.add_argument("--IncludeNoisyAgentTeamBenchmark", action="store_true", help="also run the noisy Hub AgentTeam microbenchmark")
    args = parser.parse_args()

    # EventBus/outbox/OIDC TTL 行为测试已拆分子包（EventBus→internal/bus、
    # outbox→service/deliveryoutbox + service/agent gorm 编排测试、
    # OIDC→service/oidc）；旧 ./internal/service + TestBus/TestOutbox 过滤
    # 不再命中任何测试（空门禁），故按子包拆分步骤：bus/deliveryoutbox 整包
    # 运行（新增测试自动纳入），agent/oidc 保持窄过滤。
    invoke_step("Hub EventBus behavior", HUB_ROOT, [
        "test", "./internal/bus",
        "-short", "-count=1",
    ])

    invoke_step("Hub outbox behavior (deliveryoutbox)", HUB_ROOT, [
        "test", "./internal/service/deliveryoutbox",
        "-short", "-count=1",
    ])

    invoke_step("Hub outbox orchestration integration (service/agent)", HUB_ROOT, [
        "test", "./internal/service/agent",
        "-run", "TestOutbox",
        "-short", "-count=1",
    ])

    invoke_step("Hub OIDC TTL behavior (service/oidc)", HUB_ROOT, [
        "test", "./internal/service/oidc",
        "-run", "TestGenerateAuthorizationURL|TestHandleCallback_(StateExpired|RejectsStaleStateEntryBeforeTokenExchange)",
        "-short", "-count=1",
    ])

    invoke_step("Hub scheduler/rate-limit/WS behavior", HUB_ROOT, [
        "test", "./internal/app", "./internal/middleware", "./internal/ws",
        "-run", "Test(PublishExpiredTaskTimeout|AdminMuxRequiresBasicAuthForMetricsAndPprof|AdminListenAddrUsesLoopback|GlobalRateLimit|RateLimit|WSIPRateLimit|WSUserConnLimiter|Manager|Frame)",
        "-short", "-count=1",
    ])

    invoke_step("Edge events/lifecycle/store/adapters behavior", EDGE_ROOT, [
        "test", "./internal/events", "./internal/lifecycle", "./internal/store", "./internal/adapters",
        "-run", "Test(Bus|ProcessExecutor(StartCancelRace|TooManyConcurrentRuns|ContextCancellationMidRun|StartWithRunTimeoutCancelsSlowRun)|ResultAggregator|SQLite|Store|SDKAdapterLatencyBaseline)",
        "-short", "-count=1",
    ])

    if not args.SkipBenchmarks:
        invoke_step("Edge microbenchmarks", EDGE_ROOT, [
            "test", "./internal/events", "./internal/adapters", "./internal/lifecycle",
            "-run", "^$",
            "-bench", "Benchmark(Bus|SDKAdapterLatency|ClassifyComplexity|SanitizeSubAgentResult)",
            f"-benchtime={args.Benchtime}",
            "-count=1",
        ])

        invoke_step("Hub microbenchmarks", HUB_ROOT, [
            "test", "./internal/service", "./internal/ws", "./internal/jwtutil",
            "./internal/middleware", "./internal/repository",
            "-run", "^$",
            # middleware: AuthHandler（JWT 校验）、限流（WS 令牌桶/连接数/
            # Redis 滑动窗口/全局固定窗口）；repository: 审计链写入（内存
            # sqlite 纯路径）与链哈希。
            "-bench", "Benchmark(EventBus|Frame|Generate|Parse|JWT|KeyManager|HashRefreshToken"
            "|AuthHandler|WSIPRateLimitNewIP|WSUserConnLimiterAcquireRelease"
            "|RateLimitSlidingWindowAllow|GlobalRateLimitAllow"
            "|CreateAuditEventSQLite|AuditLinkHash)",
            f"-benchtime={args.Benchtime}",
            "-count=1",
        ])

        if args.IncludeNoisyAgentTeamBenchmark:
            invoke_step("Hub AgentTeam noisy microbenchmark", HUB_ROOT, [
                "test", "./internal/service/agentteam",
                "-run", "^$",
                "-bench", "BenchmarkRouteDecision",
                f"-benchtime={args.Benchtime}",
                "-count=1",
            ])

    print("backend perf/leak gate bundle ok")
    print("Evidence boundary: behavior gates and microbenchmarks passed; pprof/leak and production capacity are not proven by this script.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
