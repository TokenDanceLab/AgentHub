"""Static route extraction for hub-server/internal/router/router.go.

Shared by the OpenAPI and shared-client contract gates so the gin group/route
syntax is parsed in one place. Route parameters are normalized to ``{param}``:
comparisons are about route shape, not parameter names.
"""

import re

GROUP = re.compile(r'(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"', re.IGNORECASE)
ROUTE = re.compile(r'(\w+)\.(GET|POST|PUT|DELETE|PATCH)\("([^"]*)"')
PARAMETER = re.compile(r":\w+")
PLACEHOLDER = re.compile(r"\{[^}]+\}")


def normalize(path: str) -> str:
    return PLACEHOLDER.sub("{param}", PARAMETER.sub("{param}", path))


def routes(router_path: str) -> set:
    """Return ``METHOD /path`` entries registered on the root engine."""
    with open(router_path, encoding="utf-8", errors="replace") as handle:
        lines = [line for line in handle.read().splitlines() if not line.lstrip().startswith("//")]

    prefixes = {}
    changed = True
    while changed:
        changed = False
        for line in lines:
            match = GROUP.search(line)
            if not match:
                continue
            variable, parent, segment = match.groups()
            if variable in prefixes:
                continue
            if parent == "r":
                prefixes[variable] = segment
            elif parent in prefixes:
                prefixes[variable] = prefixes[parent] + segment
            else:
                continue
            changed = True

    registered = set()
    for line in lines:
        for match in ROUTE.finditer(line):
            variable, method, path = match.groups()
            base = "" if variable == "r" else prefixes.get(variable)
            if base is None:
                continue
            registered.add(f"{method} {normalize(base + path)}")
    return registered


def paths(router_path: str) -> set:
    return {entry.split(" ", 1)[1] for entry in routes(router_path)}
