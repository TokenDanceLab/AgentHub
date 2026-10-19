#!/usr/bin/env python3
"""AgentHub documentation SSOT gate.

Enforces the documentation invariants stated in AGENTS.md:

- AGENTS.md is the only root rule surface;
- README.md links the developer entry points and they exist;
- paths named in AGENTS.md exist;
- docs/governance/verifier-map.md is owned by AGENTS.md and points at real scripts;
- relative links in tracked docs resolve and stay inside this repository;
- AGENTS.md is referenced by topic name, not by section number;
- AGENTS.md stays within 300 lines and other docs within 1500.
"""

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
while not os.path.isfile(os.path.join(ROOT, "AGENTS.md")):
    parent = os.path.dirname(ROOT)
    if parent == ROOT:
        raise SystemExit("cannot locate AgentHub repository root")
    ROOT = parent

MAX_AGENTS_LINES = 300
MAX_DOC_LINES = 1500
ROOT_RULE_FILES = ("CLAUDE.md", "CODEX.md", "GEMINI.md", "CURSOR.md", "PROGRESS.md", "STATE.md", "ROADMAP.md")
README_ENTRYPOINTS = ("docs/developer-quickstart.md", "docs/architecture.md", "AGENTS.md")
VERIFIER_MAP = "docs/governance/verifier-map.md"
LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
SECTION_REFERENCE = re.compile(r"AGENTS\.md[^\n]{0,80}§\s*\d", re.IGNORECASE)


def fail(message: str) -> None:
    raise RuntimeError(f"doc SSOT: {message}")


def repo_path(relative: str) -> str:
    return os.path.join(ROOT, relative.replace("/", os.sep))


def exists(relative: str) -> bool:
    return os.path.exists(repo_path(relative))


def read(relative: str) -> str:
    with open(repo_path(relative), encoding="utf-8", errors="replace") as handle:
        return handle.read()


def line_count(relative: str) -> int:
    return sum(1 for _ in open(repo_path(relative), encoding="utf-8", errors="replace"))


def tracked_markdown() -> list:
    result = subprocess.run(
        ["git", "-C", ROOT, "ls-files", "*.md"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        fail(f"git ls-files failed: {result.stderr}")
    # CHANGELOG is generated history, not an editable doc.
    return [path for path in result.stdout.splitlines() if path != "CHANGELOG.md" and exists(path)]


def expand_braces(path: str) -> list:
    match = re.match(r"^([^{]*)\{([^}]+)\}(.*)$", path)
    if not match:
        return [path]
    prefix, alternatives, suffix = match.groups()
    return [f"{prefix}{alternative}{suffix}" for alternative in alternatives.split(",")]


def check_root_rule_surface() -> None:
    for name in ROOT_RULE_FILES:
        if exists(name):
            fail(f"{name} must not exist; AGENTS.md is the single project rule surface")


def check_readme_entrypoints() -> None:
    readme = read("README.md")
    for target in README_ENTRYPOINTS:
        if not re.search(r"\[[^\]]+\]\(" + re.escape(target) + r"\)", readme):
            fail(f"README.md is missing the `{target}` entry point link")
        if not exists(target):
            fail(f"README.md entry point does not exist: {target}")


def check_agents_paths() -> None:
    content = re.sub(r"```[\s\S]*?```", "", read("AGENTS.md"))
    checked = 0
    for match in re.finditer(r"`([^`]*)`", content):
        candidate = match.group(1).strip()
        if "/" not in candidate or candidate.startswith(("/", "../")):
            continue
        if candidate.startswith((".agenthub/", ".worktrees/")) or re.search(r"[*?<>@\s]", candidate):
            continue
        for path in expand_braces(re.sub(r"^\./", "", candidate)):
            if not exists(path):
                fail(f"AGENTS.md references missing path: {path}")
            checked += 1
    print(f"AGENTS.md path check ok ({checked} paths)")


def check_verifier_map() -> None:
    if not exists(VERIFIER_MAP):
        fail(f"{VERIFIER_MAP} is missing; it is the rule-to-verifier SSOT")
    if VERIFIER_MAP not in read("AGENTS.md"):
        fail(f"AGENTS.md must point to {VERIFIER_MAP}")
    checked = 0
    for line in read(VERIFIER_MAP).splitlines():
        cells = line.split("|")
        if len(cells) < 5:
            continue
        for reference in re.findall(r"`([^`]+)`", cells[2]):
            for path in expand_braces(reference.strip()):
                if not exists(path):
                    fail(f"{VERIFIER_MAP} references missing path: {path}")
                checked += 1
    if not checked:
        fail(f"{VERIFIER_MAP} lists no verifier scripts")
    print(f"verifier-map check ok ({checked} script paths)")


def check_links() -> None:
    root_prefix = ROOT.rstrip("/\\") + os.sep
    for document in tracked_markdown():
        document_dir = os.path.dirname(document)
        for target in LINK.findall(read(document)):
            target = target.strip()
            if not target or target.startswith(("#", "<")) or re.match(r"^[a-z]+://", target) or target.startswith("mailto:"):
                continue
            path_part = target.split("#", 1)[0]
            if not path_part:
                continue
            resolved = os.path.normpath(os.path.join(ROOT, document_dir, path_part))
            if not resolved.startswith(root_prefix):
                fail(f"{document} links outside the standalone repository: {target}")
            if not os.path.exists(resolved):
                fail(f"{document} links to a missing target: {target}")


def check_agents_references() -> None:
    for document in tracked_markdown():
        if document == "AGENTS.md":
            continue
        content = re.sub(r"```[\s\S]*?```", "", read(document))
        for number, line in enumerate(content.splitlines(), start=1):
            if SECTION_REFERENCE.search(line):
                fail(f"{document}:{number} references AGENTS.md by section number; use the topic name")


def check_size_budget() -> None:
    for document in tracked_markdown():
        limit = MAX_AGENTS_LINES if document == "AGENTS.md" else MAX_DOC_LINES
        count = line_count(document)
        if count > limit:
            fail(f"{document} has {count} lines; the limit is {limit}")


CHECKS = (
    check_root_rule_surface,
    check_readme_entrypoints,
    check_agents_paths,
    check_verifier_map,
    check_links,
    check_agents_references,
    check_size_budget,
)


def run_self_test() -> None:
    global ROOT
    import tempfile

    original = ROOT
    cases = (
        ("root-rule-file", {"CLAUDE.md": "# duplicate rules\n"}, check_root_rule_surface, "must not exist"),
        ("readme-entrypoint", {"README.md": "# no entry points\n"}, check_readme_entrypoints, "entry point"),
        ("broken-link", {"README.md": "[missing](docs/gone.md)\n"}, check_links, "missing target"),
        ("out-of-repo-link", {"README.md": "[sibling](../outside.md)\n"}, check_links, "outside the standalone"),
        ("numbered-reference", {"README.md": "rules: AGENTS.md §6\n"}, check_agents_references, "topic name"),
        ("size-budget", {"AGENTS.md": "line\n" * (MAX_AGENTS_LINES + 1)}, check_size_budget, "limit is"),
        ("verifier-map", {"AGENTS.md": "# no map pointer\n"}, check_verifier_map, "missing"),
    )
    try:
        for label, files, check, expected in cases:
            with tempfile.TemporaryDirectory(prefix="agenthub-doc-ssot-") as fixture:
                ROOT = fixture
                subprocess.run(["git", "init", "-q", fixture], check=True, capture_output=True)
                for relative, content in files.items():
                    target = os.path.join(fixture, *relative.split("/"))
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with open(target, "w", encoding="utf-8", newline="\n") as handle:
                        handle.write(content)
                subprocess.run(["git", "-C", fixture, "add", "-A"], check=True, capture_output=True)
                try:
                    check()
                except RuntimeError as exc:
                    if expected not in str(exc):
                        raise AssertionError(f"{label}: failed for the wrong reason: {exc}") from exc
                else:
                    raise AssertionError(f"{label}: not rejected")
    finally:
        ROOT = original
    print("doc SSOT self-test ok")


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
    except Exception as exc:  # noqa: BLE001 - fail closed
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
