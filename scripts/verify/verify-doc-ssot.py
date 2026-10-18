#!/usr/bin/env python3
"""verify-doc-ssot — AgentHub 文档 SSOT 门禁。

门禁检查项：
- 根入口点/过期路径/归档活动路径禁存在；
- README 必需入口点链接 + 目标存在；
- README zh/en 成熟度口径 parity（配对标记同现/同缺）；
- 表中列出的 (路径, 标记) 必须出现在对应文档；
- 少量禁止正则扫描活跃文档；
- 行数上限表（AGENTS.md 300 行预算）；AGENTS.md 反引号路径存在性；
- 文档引用 AGENTS 规则时必须使用主题名，禁止易漂移的章节编号；
- 规则→机器验证映射 SSOT（docs/governance/verifier-map.md）存在性 + AGENTS owner 指针；
- 活跃文档内部 markdown 相对链接目标存在性（DOC-BROKEN-LINK）；
- standalone clone 可达性：活跃文档不得有解析出仓库的相对链接/路径（DOC-OUT-OF-REPO-LINK）。

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
    if p in ("AGENTS.md", "CONTRIBUTING.md", "README.md", "README_EN.md"):
        return True
    if p in ("api/README.md", "api/events.md", "api/conventions.md"):
        return True
    if p == "edge-server/README.md":
        return True
    if p in ("hub-server/README.md", "hub-server/deployments/README.md", "hub-server/tests/README.md"):
        return True
    if p in ("app/web/README.md", "app/desktop/README.md", "app/mobile-rn/README.md"):
        return True
    if p in ("docs/README.md", "docs/decisions.md", "docs/developer-quickstart.md", "docs/component-acceptance.md"):
        return True
    if re.match(r"^docs/(architecture|reference)/.+\.md$", p):
        return True
    if re.match(r"^docs/governance/.+\.md$", p):
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
        "docs/archive", "docs/archives", "docs/adr", "docs/audit", "docs/analysis",
        "docs/api-reference.md",
        "docs/architecture/09-dev-server-topology.md",
        "docs/architecture/11-protocol-capability-mapping.md",
        "docs/reference/sdk-agent-strategy.md",
        "docs/reference/agent-protocol-compat.md",
        "docs/reference/ux-benchmark-2026-08.md",
        "docs/reference/projects", "api/events-full.md",
    ]
    for path in stale:
        if exists(path):
            fail(f"{path} must stay removed from active docs", "DOC-STALE-PATH")
    archived_active = [
        "docs/governance/branch-governance.md",
    ]
    for path in archived_active:
        if exists(path):
            fail(f"{path} must stay removed; active rules live in AGENTS.md and app/mobile-rn/README.md")


def check_dated_governance() -> None:
    governance_dir = os.path.join(ROOT, "docs", "governance")
    dated = []
    if os.path.isdir(governance_dir):
        for name in os.listdir(governance_dir):
            if name.endswith(".md") and re.search(r"\d{4}-\d{2}-\d{2}", name):
                dated.append(name)
    if dated:
        fail("dated governance evidence is not allowed in active docs: " + ", ".join(sorted(dated)))


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
        ("docs/decisions.md", "ADR-017"),
        ("api/events.md", "Owner"),
        ("app/desktop/README.md", "packaged-release"),
        ("app/desktop/README.md", "Vite renderer 证据不等于 packaged Desktop"),
        ("app/mobile-rn/README.md", "real_tested=false"),
        ("app/mobile-rn/README.md", "Mobile must not connect directly to Local Edge"),
        ("edge-server/README.md", "Source Map"),
        ("hub-server/README.md", "Source Map"),
        ("hub-server/tests/README.md", "Integration Tests"),
        ("docs/architecture/05-deployment.md", "Desktop packaged 行为正确"),
        ("scripts/release/verify-tauri-package-readiness.py", "assert_workflow_command_explicit_opt_in"),
        ("scripts/release/verify-tauri-package-readiness.py", "assert_no_macos_unsigned_dry_release_actions"),
        ("scripts/release/verify-tauri-package-dry.py", "windows-desktop-package-dry"),
        ("docs/architecture/04-frontend-data-flow.md", "Source Owner Map"),
        ("hub-server/README.md", "verify-backend-perf-leak-gates.py"),
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
        (r"(?<![\w-])/(goal|loop)(?![\w-])", "legacy /goal or /loop workflow rule"),
        (r"docs/architecture/system-design/", "removed system-design architecture path"),
        (r"docs/operations/desktop-ui-qa-sop", "removed Desktop UI QA SOP path"),
    ]
    files = [normalize_path(f) for f in git_ls_files() if is_active_doc(f) and exists(f)]
    for rel in files:
        content = read_text(rel)
        if re.search(r"CLAUDE\.md", content) and rel not in allowed_claude_mentions:
            fail(f"{rel} contains CLAUDE.md outside the allowed negative/ownership notes")
        for pattern, message in forbidden:
            if re.search(pattern, content):
                fail(f"{rel} contains {message}")


def check_no_numbered_agents_references() -> None:
    """Prevent drift-prone references such as ``AGENTS.md §6``.

    AGENTS headings may be reordered as the project evolves. Consumer docs must
    name the topic (for example, “Git 和 worktree”) so a renumbering does not
    silently break every pointer. CHANGELOG.md is immutable historical prose and
    is therefore excluded.
    """
    pattern = re.compile(r"AGENTS\.md[^\n]{0,80}§\s*\d", re.IGNORECASE)
    offenders: list[str] = []
    for rel in git_ls_files(["*.md"]):
        rel = normalize_path(rel)
        if rel == "CHANGELOG.md" or rel.endswith("AGENTS.md") or not exists(rel):
            continue
        content = re.sub(r"```[\s\S]*?```", "", read_text(rel))
        for line_no, line in enumerate(content.splitlines(), start=1):
            if pattern.search(line):
                offenders.append(f"{rel}:{line_no}")
    if offenders:
        fail(
            "reference AGENTS rules by topic name, not section number: " + ", ".join(offenders),
            "DOC-AGENTS-NUMBERED-REF",
        )


def check_max_lines() -> None:
    limits = {
        "AGENTS.md": 300,
        "CHANGELOG.md": 90,
        "CONTRIBUTING.md": 90,
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
        "docs/README.md": 120,
        "docs/decisions.md": 80,
        "docs/developer-quickstart.md": 170,
        "docs/architecture.md": 170,
        "docs/architecture/01-hub-server.md": 200,
        "docs/architecture/02-edge-server.md": 200,
        "docs/architecture/03-runtime-adapters.md": 200,
        "docs/architecture/04-frontend-data-flow.md": 150,
        "docs/architecture/05-deployment.md": 200,
        "docs/architecture/06-auth-identity.md": 200,
        "docs/architecture/07-design-system-ssot.md": 150,
        "docs/architecture/08-outbound-http.md": 150,
        "docs/architecture/github-actions-ci-cd-policy.md": 120,
        "docs/architecture/10-macro-engineering-design.md": 150,
        "docs/component-acceptance.md": 130,
        "docs/reference/README.md": 80,
        "docs/reference/agent-protocols.md": 150,
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
    """Mapping SSOT is docs/governance/verifier-map.md.

    This check verifies the script paths and CI files referenced by that
    document.
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
        for script_match in re.finditer(r"`([^`]*)`", cells[2]):
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
    if checked_scripts < 20 or checked_ci_files < 10:
        fail(
            f"verifier-map.md looks emptied or truncated ({checked_scripts} script paths, "
            f"{checked_ci_files} CI files); refusing to report green",
            code="DOC-VERIFIER-MAP-OWNER",
        )
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
        ("Mobile 是装配中的", "Mobile is an in-assembly"),
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
    paths that resolve above the repo root are dead for every external reader.
    Public http(s):// URLs are the only allowed out-of-repo references.
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

    Broken links silently degrade navigation. http(s)://, mailto:, bare anchors
    and code spans are skipped.
    """
    entry_dirs = ["docs", "docs/architecture", "docs/governance", "docs/reference"]
    active_files: list[str] = []
    for d in entry_dirs:
        d_abs = os.path.join(ROOT, d)
        if os.path.isdir(d_abs):
            for name in sorted(os.listdir(d_abs)):
                if name.endswith(".md"):
                    active_files.append(os.path.join(d, name))
    # Also cover root-level and module README files that is_active_doc() tracks,
    # so broken links in README.md / CONTRIBUTING.md / AGENTS.md markdown links
    # are caught (previously only the 4 docs/ subdirectories were scanned).
    for f in git_ls_files():
        if is_active_doc(f) and exists(f) and f not in active_files:
            active_files.append(f)
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


def run_self_test() -> None:
    """Negative fixtures for the documentation guards."""
    global ROOT
    import tempfile

    original = ROOT
    expected_checks = {
        "check_root_entrypoints", "check_stale_paths", "check_dated_governance",
        "check_readme_entrypoints", "check_readme_parity", "check_required_markers",
        "check_forbidden_patterns", "check_no_numbered_agents_references", "check_max_lines",
        "check_verifier_map_owner", "check_agents_md_mapping_table", "check_agents_md_paths",
        "check_doc_internal_links", "check_out_of_repo_links",
    }
    wired = {check.__name__ for check in CHECKS}
    missing = sorted(expected_checks - wired)
    if missing:
        raise AssertionError(f"main() no longer runs guard(s): {', '.join(missing)}")
    try:
        guard_cases = (
            ("root-entrypoint", {"PROGRESS.md": "fixture\n"}, check_root_entrypoints, "DOC-ROOT-ENTRYPOINT"),
            ("stale-path", {"docs/analysis/overview.md": "fixture\n"}, check_stale_paths, "DOC-STALE-PATH"),
            ("readme-entrypoint", {"README.md": "# no entrypoint links\n"}, check_readme_entrypoints,
             "DOC-README-ENTRYPOINT"),
            ("readme-parity", {"README.md": "Mobile 是装配中的\n", "README_EN.md": "# en\n"},
             check_readme_parity, "DOC-README-PARITY"),
            ("forbidden-pattern", {"docs/architecture/sample.md": "见 STATE.md\n"},
             check_forbidden_patterns, "STATE.md"),
            ("numbered-agents-reference", {"README.md": "规则见 AGENTS.md §6\n"},
             check_no_numbered_agents_references, "DOC-AGENTS-NUMBERED-REF"),
            ("max-lines", {"AGENTS.md": "padding\n" * 301}, check_max_lines, "DOC-MAX-LINES"),
            ("verifier-map-owner", {"AGENTS.md": "# no verifier-map pointer\n"},
             check_verifier_map_owner, "DOC-VERIFIER-MAP-OWNER"),
            ("out-of-repo-link", {"README.md": "[sibling](../outside.md)\n"},
             check_out_of_repo_links, "DOC-OUT-OF-REPO-LINK"),
        )
        for label, files, check, expected in guard_cases:
            with tempfile.TemporaryDirectory(prefix="agenthub-doc-guard-") as fixture:
                ROOT = fixture
                subprocess.run(["git", "init", "-q", fixture], check=True, capture_output=True)
                for rel, content in files.items():
                    path = os.path.join(fixture, *rel.split("/"))
                    os.makedirs(os.path.dirname(path) or fixture, exist_ok=True)
                    with open(path, "w", encoding="utf-8", newline="\n") as handle:
                        handle.write(content)
                subprocess.run(["git", "-C", fixture, "add", "-A"], check=True, capture_output=True)
                try:
                    check()
                except RuntimeError as exc:
                    if expected not in str(exc):
                        raise AssertionError(
                            f"guard case '{label}' failed for the wrong reason: {exc}"
                        ) from exc
                else:
                    raise AssertionError(f"guard case '{label}' was not rejected")
    finally:
        ROOT = original
    print("doc SSOT self-test ok")


# Every guard main() runs. run_self_test() asserts this list still contains
# each guard, so deleting the call is caught even when the function body stays.
CHECKS = (
    check_root_entrypoints,
    check_stale_paths,
    check_dated_governance,
    check_readme_entrypoints,
    check_readme_parity,
    check_required_markers,
    check_forbidden_patterns,
    check_no_numbered_agents_references,
    check_max_lines,
    check_verifier_map_owner,
    check_agents_md_mapping_table,
    check_agents_md_paths,
    check_doc_internal_links,
    check_out_of_repo_links,
)

def main() -> int:
    if "--self-test" in sys.argv[1:]:
        run_self_test()
        return 0
    for check in CHECKS:
        check()
    print("doc SSOT ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— fail closed：未捕获异常返回非零
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
