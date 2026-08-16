#!/usr/bin/env python3
"""verify-doc-ssot — AgentHub 文档 SSOT 门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

门禁检查项：
- 根入口点/过期路径/归档活动路径禁存在；
- README 必需入口点链接 + 目标存在；
- README zh/en 成熟度口径 parity（配对标记同现/同缺）；
- 约 35 个 (路径, 标记) 必须出现在对应文档；
- 约 30 个禁止正则扫描活跃文档；
- 行数上限表（AGENTS.md 300 行预算）；AGENTS.md 反引号路径存在性；
- 规则→机器验证映射 SSOT（docs/governance/verifier-map.md）存在性 + AGENTS owner 指针；
- 活跃文档内部 markdown 相对链接目标存在性（DOC-BROKEN-LINK）；
- standalone clone 可达性：活跃文档不得有解析出仓库的相对链接/路径（DOC-OUT-OF-REPO-LINK）；
- tests/ 不得镜像 scripts/ 脚本名。

"""

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
for _ in range(4):
    if os.path.isfile(os.path.join(ROOT, "AGENTS.md")):
        break
    ROOT = os.path.dirname(ROOT)
else:
    raise RuntimeError("cannot locate AgentHub repository root")

FAIL_CODE = re.compile(r"^DOC-[A-Z0-9-]+$")


def fail(message: str, code: str = "DOC-SSOT") -> None:
    if not FAIL_CODE.match(code):
        raise RuntimeError(f"invalid doc SSOT failure code: {code}")
    raise RuntimeError(f"doc SSOT check failed [{code}]: {message}")


def normalize_path(path: str) -> str:
    return path.replace("\\", "/")


def is_active_doc(path: str) -> bool:
    p = normalize_path(path)
    if re.match(r"^docs/(archive|archives|audit|release)/", p):
        return False
    if p in ("AGENTS.md", "CONTRIBUTING.md", "reference/INDEX.md", "README.md", "README_EN.md"):
        return True
    if p in ("api/README.md", "api/events.md", "api/conventions.md"):
        return True
    if p == "edge-server/README.md":
        return True
    if p in ("hub-server/README.md", "hub-server/deployments/README.md", "hub-server/tests/README.md"):
        return True
    if p in ("app/web/README.md", "app/desktop/README.md", "app/mobile-rn/README.md"):
        return True
    if p == "docs/reference/backend-performance-gates.md":
        return True
    if p in ("docs/README.md", "docs/history.md", "docs/decisions.md", "docs/reference/README.md", "docs/api-reference.md"):
        return True
    if re.match(r"^docs/governance/.+\.md$", p):
        return True
    if re.match(r"^\.agents/skills/.+\.md$", p):
        return True
    return False


def exists(rel_path: str) -> bool:
    return os.path.exists(os.path.join(ROOT, rel_path.replace("/", os.sep)))


def git_ls_files(patterns=None) -> list:
    command = ["git", "-C", ROOT, "ls-files"]
    if patterns:
        command.extend(patterns)
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        fail(f"git ls-files failed: {result.stderr}")
    return result.stdout.splitlines()


def read_text(rel_path: str) -> str:
    with open(os.path.join(ROOT, rel_path.replace("/", os.sep)), encoding="utf-8", errors="replace") as handle:
        return handle.read()


def line_count(rel_path: str) -> int:
    with open(os.path.join(ROOT, rel_path.replace("/", os.sep)), encoding="utf-8", errors="replace") as handle:
        return sum(1 for _ in handle)


def check_root_entrypoints() -> None:
    forbidden = [
        ("CLAUDE.md", "AGENTS.md is the single project rule surface"),
        ("CODEX.md", "tool-specific rules must not fork AGENTS.md"),
        ("GEMINI.md", "tool-specific rules must not fork AGENTS.md"),
        ("CURSOR.md", "tool-specific rules must not fork AGENTS.md"),
        ("PROGRESS.md", "progress state lives on GitHub issues, not a repo file"),
        ("STATE.md", "current facts live in AGENTS.md and owner docs, not a root STATE.md"),
        ("ROADMAP.md", "roadmap state lives on GitHub issues, not a repo file"),
    ]
    for path, reason in forbidden:
        if exists(path):
            fail(f"root {path} must not exist; {reason}", "DOC-ROOT-ENTRYPOINT")


def check_stale_paths() -> None:
    stale = [
        "docs/contributing.md", "docs/roadmap", "docs/adr", "docs/audit",
        "docs/reference/projects", "docs/release/screenshot-checklist.md",
        "docs/governance/document-standards.md", "docs/governance/workflow-standard.md",
        "docs/analysis/_raw_lane_results.json", "docs/analysis/cleanup-strategy.md",
        "docs/analysis/engineering-loop-capability-map.md", "docs/analysis/hubclient-ssot-slice1.md",
        "docs/analysis/module-inventory.md", "docs/analysis/project-overview.md",
        "docs/analysis/risk-assessment.md", "api/events-full.md",
        "edge-server/docs/audit", "hub-server/docs/audit",
    ]
    for path in stale:
        if exists(path):
            fail(f"{path} must stay archived or removed from active docs", "DOC-STALE-PATH")
    if exists("docs/reference/desktop-ui-qa-sop.md"):
        fail("old Desktop UI QA SOP must stay archived; use real-e2e-acceptance for active UI/E2E gates")
    archived_active = [
        "docs/governance/branch-governance.md",
        "app/mobile-rn/docs/handoff.md",
    ]
    for path in archived_active:
        if exists(path):
            fail(f"{path} must stay archived; active branch rules live in AGENTS.md and Mobile gates live in app/mobile-rn/README.md")


def check_dated_governance() -> None:
    governance_dir = os.path.join(ROOT, "docs", "governance")
    dated = []
    if os.path.isdir(governance_dir):
        for name in os.listdir(governance_dir):
            if name.endswith(".md") and re.search(r"\d{4}-\d{2}-\d{2}", name):
                dated.append(name)
    if dated:
        fail("dated governance evidence must live in the external archive indexed by docs/history.md: " + ", ".join(sorted(dated)))


def check_readme_entrypoints() -> None:
    readme = read_text("README.md")
    required = [
        "docs/developer-quickstart.md",
        "docs/architecture.md",
        "AGENTS.md",
    ]
    for target in required:
        link_pattern = r"\[[^\]]+\]\(" + re.escape(target) + r"\)"
        if not re.search(link_pattern, readme):
            fail(f"README.md is missing required entrypoint target: {target}", "DOC-README-ENTRYPOINT")
        if not exists(target):
            fail(f"README.md entrypoint target does not exist: {target}", "DOC-README-TARGET")


def check_required_markers() -> None:
    required = [
        ("AGENTS.md", "新 Agent 90 秒入口"),
        ("AGENTS.md", "项目总规则唯一入口"),
        ("AGENTS.md", "避免巨石文档"),
        ("AGENTS.md", "项目规则只写 `AGENTS.md`"),
        ("docs/history.md", "archive commit"),
        ("docs/history.md", "TokenDanceLab/docs"),
        ("docs/decisions.md", "ADR-017"),
        ("docs/decisions.md", "Full ADR bodies are archived"),
        ("api/events.md", "Owner"),
        ("app/web/README.md", "docs/history.md"),
        ("app/desktop/README.md", "packaged-release"),
        ("app/desktop/README.md", "Vite renderer 证据不等于 packaged Desktop"),
        ("app/mobile-rn/README.md", "real_tested=false"),
        ("app/mobile-rn/README.md", "Mobile must not connect directly to Local Edge"),
        ("edge-server/README.md", "Source Map"),
        ("hub-server/README.md", "Source Map"),
        ("hub-server/deployments/README.md", "Live host"),
        ("hub-server/tests/README.md", "Integration Tests"),
        ("docs/reference/backend-performance-gates.md", "Current Scope"),
        ("docs/reference/backend-performance-gates.md", "Gate Matrix"),
        ("docs/reference/backend-performance-gates.md", "Do Not Claim"),
        ("reference/INDEX.md", "docs/reference/README.md"),
        ("CONTRIBUTING.md", "旧详细贡献指南见"),
        ("docs/governance/governance-execution.md", "D2b. Release dry build topology"),
        ("docs/governance/governance-execution.md", "later approval slice"),
        ("docs/architecture/05-deployment.md", "Desktop packaged 行为正确"),
        ("scripts/release/verify-tauri-package-readiness.py", "assert_workflow_command_explicit_opt_in"),
        ("scripts/release/verify-tauri-package-readiness.py", "assert_no_macos_unsigned_dry_release_actions"),
        ("scripts/release/verify-tauri-package-dry.py", "windows-desktop-package-dry"),
        ("docs/architecture/04-frontend-data-flow.md", "Source Owner Map"),
        ("hub-server/README.md", "docs/reference/backend-performance-gates.md"),
        ("edge-server/README.md", "verify-backend-perf-leak-gates.py"),
    ]
    for path, marker in required:
        if marker not in read_text(path):
            fail(f"{path} is missing required ownership marker: {marker}")


def check_forbidden_patterns() -> None:
    allowed_claude_mentions = ["AGENTS.md"]
    forbidden = [
        (r"AGENTS\.md\s*/\s*CLAUDE\.md", "legacy AGENTS/CLAUDE dual-rule wording"),
        (r"STATE\.md", "root STATE.md as an active project fact source"),
        (r"ROADMAP\.md", "uppercase ROADMAP.md legacy reference"),
        (r"GPT-5\.5", "hard-coded private/local model alias"),
        (r"(?<![\w-])/(goal|loop)(?![\w-])", "legacy Codex /goal or /loop workflow rule"),
        (r"Desktop/Web UI freeze|UI freeze", "obsolete UI freeze rule"),
        (r"Phase 2 Real E2E Contract\s*\|\s*进行中", "stale Phase 2 progress state"),
        (r"current pre-Phase 3 hygiene branch `docs/active-doc-regroup`", "stale active-doc-regroup branch status"),
        (r"Review and merge `docs/active-doc-regroup`", "stale active-doc-regroup next step"),
        (r"docs/module-readme-trim", "stale module-readme cleanup branch presented as active work"),
        (r"T3\.0b\s*\|\s*#344[^\r\n]*\|\s*open", "stale #344 open status after module README cleanup merged"),
        (r"#344\s*/\s*T3\.0b\s+on", "stale #344 active-task wording"),
        (r"Phase 3 Source And Test Alignment\s*\|\s*待开始", "stale Phase 3 not-started roadmap state"),
        (r"Phase 3: Source And Test Alignment\s*\(1/7 tasks\)", "stale Phase 3 pre-#344 progress count"),
        (r"current governance/source-contract branch", "stale current branch prose in progress docs"),
        (r"Mobile tests pass", "stale Mobile pass claim"),
        (r"Local mock Hub check passed", "stale Mobile mock-Hub pass claim"),
        (r"Visual QA should pass", "stale Mobile visual QA pass claim"),
        (r"Wi-Fi ADB", "stale Mobile device proof wording"),
        (r"v0\.3\.0-rc\.7", "stale Mobile release-candidate proof wording"),
        (r"Current branch handoff", "stale Mobile handoff owner wording"),
        (r"真实执行已验证", "stale real-execution acceptance claim without current approved-real evidence"),
        (r"当前事实写在\s+`?STATE\.md`?", "old STATE.md fact-owner rule"),
        (r"docs/architecture/system-design/", "removed system-design architecture path"),
        (r"docs/operations/desktop-ui-qa-sop", "removed Desktop UI QA SOP path"),
        (r"app/web/screenshots/web-design", "old Web screenshot evidence list in active docs"),
        (r"132 tests|278 tests|11/11|12/12\s+(Mock|curl|tests|PASS)", "fixed test-count acceptance claim"),
    ]
    files = [normalize_path(f) for f in git_ls_files() if is_active_doc(f) and exists(f)]
    for rel in files:
        content = read_text(rel)
        if re.search(r"CLAUDE\.md", content) and rel not in allowed_claude_mentions:
            fail(f"{rel} contains CLAUDE.md outside the allowed negative/ownership notes")
        for pattern, message in forbidden:
            if re.search(pattern, content):
                fail(f"{rel} contains {message}")


def check_max_lines() -> None:
    limits = {
        "AGENTS.md": 300,
        "CHANGELOG.md": 90,
        "CONTRIBUTING.md": 90,
        "reference/INDEX.md": 80,
        "api/README.md": 100,
        "api/events.md": 180,
        "api/conventions.md": 190,
        "app/web/README.md": 95,
        "app/desktop/README.md": 95,
        "app/mobile-rn/README.md": 95,
        "edge-server/README.md": 115,
        "hub-server/README.md": 120,
        "hub-server/deployments/README.md": 100,
        "hub-server/tests/README.md": 70,
        "docs/reference/backend-performance-gates.md": 115,
        "docs/README.md": 120,
        "docs/history.md": 80,
        "docs/decisions.md": 80,
        "docs/developer-quickstart.md": 170,
        "docs/architecture.md": 170,
        "docs/architecture/04-frontend-data-flow.md": 150,
        "docs/api-reference.md": 80,
        "docs/reference/README.md": 80,
        "docs/reference/sdk-agent-strategy.md": 120,
        "docs/reference/agent-protocol-compat.md": 100,
        "docs/governance/security-risk-register.md": 180,
        "docs/governance/threat-model.md": 140,
        "docs/governance/governance-execution.md": 110,
        "docs/governance/verifier-map.md": 120,
    }
    for path, limit in limits.items():
        if exists(path) and line_count(path) > limit:
            fail(
                f"{path} has {line_count(path)} lines; active entry limit is {limit}. Move detail to owner docs or archive.",
                "DOC-MAX-LINES",
            )


def check_agents_md_paths() -> None:
    content = re.sub(r"```[\s\S]*?```", "", read_text("AGENTS.md"))
    checked = 0
    for match in re.finditer(r"`([^`]*)`", content):
        p = match.group(1).strip()
        if re.match(r"^\.\./", p):
            fail(f"AGENTS.md must not reference out-of-repo path: {p}", "DOC-OUT-OF-REPO-LINK")
        if re.match(r"^\.(agenthub|claude|codex)/", p):
            continue
        if re.match(r"^\.worktrees/", p):
            continue
        if "/" not in p:
            continue
        if re.search(r"[*?<>@]", p):
            continue
        if p.startswith("/"):
            continue
        if re.search(r"\s", p):
            continue
        p = re.sub(r"^\./", "", p)
        for candidate in expand_brace_path(p):
            if not exists(candidate):
                fail(f"AGENTS.md references missing path: {candidate}")
            checked += 1
    print(f"AGENTS.md path check ok ({checked} paths)")


def expand_brace_path(path: str) -> list:
    match = re.match(r"^([^{]*)\{([^}]+)\}(.*)$", path)
    if not match:
        return [path]
    prefix, middle, suffix = match.group(1), match.group(2), match.group(3)
    return [f"{prefix}{part}{suffix}" for part in middle.split(",")]


def check_agents_md_mapping_table() -> None:
    """Mapping SSOT moved to docs/governance/verifier-map.md (#1719).

    The long table no longer lives in AGENTS.md §9.5; this check verifies the
    script paths and CI files referenced by the new owner document.
    """
    content = read_text("docs/governance/verifier-map.md")
    checked_scripts = 0
    checked_ci_files = 0
    for line in content.splitlines():
        if not re.match(r"^\s*\|", line):
            continue
        cells = line.split("|")
        if len(cells) < 5:
            continue
        script_match = re.search(r"`([^`]*)`", cells[2])
        if script_match:
            ref = script_match.group(1).strip()
            for candidate in expand_brace_path(ref):
                if not exists(candidate):
                    fail(f"verifier-map.md references missing path: {candidate}")
                checked_scripts += 1
        ci_match = re.search(r"(?i)(checks\.yml|release-readiness\.yml|cd-[a-z-]+\.yml|release\.yml)", cells[3])
        if ci_match:
            ci_file = ci_match.group(1)
            if not exists(f".github/workflows/{ci_file}"):
                fail(f"verifier-map.md references missing CI file: .github/workflows/{ci_file}")
            checked_ci_files += 1
    print(f"verifier-map check ok ({checked_scripts} script paths, {checked_ci_files} CI files)")


def check_verifier_map_owner() -> None:
    if not exists("docs/governance/verifier-map.md"):
        fail(
            "docs/governance/verifier-map.md is missing; it is the SSOT for the rule-to-verifier mapping",
            "DOC-VERIFIER-MAP-OWNER",
        )
    if "docs/governance/verifier-map.md" not in read_text("AGENTS.md"):
        fail(
            "AGENTS.md must point to docs/governance/verifier-map.md as the mapping SSOT owner",
            "DOC-VERIFIER-MAP-OWNER",
        )


def check_readme_parity() -> None:
    """README zh/en maturity parity: paired markers must co-exist or co-absent.

    The two files are independently editable, so one-sided maturity edits (e.g.
    zh claiming Mobile done while en still says in assembly) would go unnoticed.
    Each pair below must appear in both READMEs or in neither.
    """
    pairs = [
        ("Mobile 装配中", "Mobile in assembly"),
        ("Desktop/Web 主线", "Desktop/Web are the mainline"),
    ]
    readme_zh = read_text("README.md")
    readme_en = read_text("README_EN.md")
    for zh_marker, en_marker in pairs:
        zh_has = zh_marker in readme_zh
        en_has = en_marker in readme_en
        if zh_has != en_has:
            fail(
                f"README maturity parity broken: {zh_marker!r} (zh) vs {en_marker!r} (en) must appear in both or neither",
                "DOC-README-PARITY",
            )


def check_out_of_repo_links() -> None:
    """Standalone-clone reachability: active docs must not link outside the repo.

    A fresh clone contains only this repository, so relative links or backtick
    paths that resolve above the repo root (e.g. sibling workspace repos like
    ../docs) are dead for every external reader. Public http(s):// URLs are the
    only allowed out-of-repo references; archives/ is exempt.
    """
    files = [normalize_path(f) for f in git_ls_files() if is_active_doc(f) and exists(f)]
    link_re = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    backtick_re = re.compile(r"`([^`]*)`")
    root_prefix = ROOT.rstrip("/\\") + os.sep
    for rel in files:
        text = read_text(rel)
        text_no_code = re.sub(r"```[\s\S]*?```", "", text)
        doc_dir = os.path.dirname(rel)
        for target in link_re.findall(text):
            target = target.strip()
            if not target or target.startswith(("<", "#")):
                continue
            if re.match(r"^[a-z]+://", target) or target.startswith("mailto:"):
                continue
            path_part = target.split("#", 1)[0]
            if not path_part:
                continue
            resolved_abs = os.path.normpath(os.path.join(ROOT, doc_dir, path_part))
            if not resolved_abs.startswith(root_prefix):
                fail(f"{rel} links outside the standalone repo: {target}", "DOC-OUT-OF-REPO-LINK")
        for match in backtick_re.finditer(text_no_code):
            path = match.group(1).strip()
            if not path.startswith("../"):
                continue
            if re.search(r"[*?<>@\s]", path):
                continue
            resolved_abs = os.path.normpath(os.path.join(ROOT, doc_dir, path))
            if not resolved_abs.startswith(root_prefix):
                fail(f"{rel} references path outside the standalone repo: {path}", "DOC-OUT-OF-REPO-LINK")


def check_doc_internal_links() -> None:
    """Verify markdown relative links inside active docs resolve to real files.

    Broken links silently degrade navigation (e.g. docs/README.md used to point
    at plan/ and analysis/ after those directories were archived). archives/ is
    exempt — archived material may legitimately point at the external TokenDance
    docs archive. http(s)://, mailto:, bare anchors and code spans are skipped.
    """
    entry_dirs = ["docs", "docs/architecture", "docs/governance", "docs/reference"]
    active_files: list[str] = []
    for d in entry_dirs:
        d_abs = os.path.join(ROOT, d)
        if os.path.isdir(d_abs):
            for name in sorted(os.listdir(d_abs)):
                if name.endswith(".md"):
                    active_files.append(os.path.join(d, name))
    link_re = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    for doc_rel in active_files:
        text = read_text(doc_rel)
        doc_dir = os.path.dirname(doc_rel)
        for target in link_re.findall(text):
            target = target.strip()
            if not target or target.startswith(("<", "#")):
                continue
            if re.match(r"^[a-z]+://", target) or target.startswith("mailto:"):
                continue
            path_part = target.split("#", 1)[0]
            if not path_part:
                continue
            resolved = os.path.normpath(os.path.join(doc_dir, path_part))
            # Only police targets inside the repo; out-of-repo links (../docs
            # sibling repos) are not verifiable from this workspace.
            resolved_abs = os.path.normpath(os.path.join(ROOT, resolved))
            if not resolved_abs.startswith(ROOT.rstrip("/\\") + os.sep):
                continue
            if not os.path.exists(resolved_abs):
                fail(f"{doc_rel} links to missing target: {target}", "DOC-BROKEN-LINK")


def check_no_script_mirror() -> None:
    script_leaves = {normalize_path(f).rsplit("/", 1)[-1] for f in git_ls_files(["scripts/"])}
    test_leaves = [
        normalize_path(f).rsplit("/", 1)[-1]
        for f in git_ls_files(["tests/"])
        if re.search(r"\.(ps1|sh|mjs|py)$", f)
    ]
    mirrors = sorted({leaf for leaf in test_leaves if leaf in script_leaves})
    if mirrors:
        fail("tests/ must not mirror scripts/ script names: " + ", ".join(mirrors))
    print("script mirror check ok (no tests/ file shares a scripts/ script name)")


def main() -> int:
    check_root_entrypoints()
    check_stale_paths()
    check_dated_governance()
    check_readme_entrypoints()
    check_readme_parity()
    check_required_markers()
    check_forbidden_patterns()
    check_max_lines()
    check_verifier_map_owner()
    check_agents_md_mapping_table()
    check_agents_md_paths()
    check_doc_internal_links()
    check_out_of_repo_links()
    check_no_script_mirror()
    print("doc SSOT ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
