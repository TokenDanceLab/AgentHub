#!/usr/bin/env python3
"""verify-openapi-contract - OpenAPI and Hub router route contract gate.

Compares every Hub-implemented operation in api/openapi.yaml with the routes
statically registered in hub-server/internal/router/router.go, and checks:

- implemented Edge operations declare a valid security requirement;
- path parameters are declared, required, schema'd, and match the template;
- Hub-implemented 2xx responses carry a body schema (baseline in
  scripts/verify/openapi-schema-baseline.json).

Exit 1 on drift, exit 0 when the contract holds.
"""

import argparse
import json
import os
import sys

import yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hub_router  # noqa: E402

SCHEMA_BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "openapi-schema-baseline.json")
METHODS = ("get", "post", "put", "delete", "patch", "head", "options")
# Admin/debug and liveness routes are not public API and stay out of OpenAPI.
ALLOWLIST = {"GET /debug/panic", "GET /health/live", "GET /health/ready"}


def fail(message: str) -> None:
    raise RuntimeError(message)


def load_spec(spec_path: str) -> dict:
    with open(spec_path, encoding="utf-8") as handle:
        spec = yaml.safe_load(handle)
    if not isinstance(spec, dict):
        fail(f"{spec_path} is not an OpenAPI mapping")
    return spec


def operations(spec: dict):
    for path, node in (spec.get("paths") or {}).items():
        if not isinstance(node, dict):
            continue
        for method, operation in node.items():
            if method in METHODS and isinstance(operation, dict):
                yield method.upper(), path, node, operation


def owner(node: dict, operation: dict) -> str:
    return str(operation.get("x-agenthub-owner") or node.get("x-agenthub-owner") or "").lower()


def status(node: dict, operation: dict) -> str:
    return str(operation.get("x-agenthub-status") or node.get("x-agenthub-status") or "").lower()


def implemented(spec: dict, component: str) -> list:
    return [
        (method, path, node, operation)
        for method, path, node, operation in operations(spec)
        if owner(node, operation) == component and status(node, operation) == "implemented"
    ]


def declared_routes(spec: dict) -> set:
    return {f"{method} {hub_router.normalize(path)}" for method, path, _node, _operation in implemented(spec, "hub")}


def schema_gaps(spec: dict) -> list:
    """Hub 2xx responses without content or $ref leave the client shape unknown."""
    gaps = []
    for method, path, _node, operation in implemented(spec, "hub"):
        for code in ("200", "201", "202"):
            response = (operation.get("responses") or {}).get(code)
            if isinstance(response, dict) and "content" not in response and "$ref" not in response:
                gaps.append(f"{method} {path} {code}")
    return sorted(gaps)


def edge_security_gaps(spec: dict) -> list:
    schemes = set(((spec.get("components") or {}).get("securitySchemes") or {}).keys())
    gaps = []
    for method, path, node, operation in implemented(spec, "edge"):
        if path == "/v1/health":
            continue
        security = operation.get("security", node.get("security"))
        if not isinstance(security, list) or not security:
            gaps.append(f"{method} {path}")
            continue
        for requirement in security:
            if not isinstance(requirement, dict) or not requirement:
                gaps.append(f"{method} {path}")
                break
            for scheme in sorted(set(requirement) - schemes):
                gaps.append(f"{method} {path} unknown security scheme '{scheme}'")
    return sorted(gaps)


def path_parameter_gaps(spec: dict) -> list:
    components = (spec.get("components") or {}).get("parameters") or {}

    def resolve(parameter):
        if not isinstance(parameter, dict) or "$ref" not in parameter:
            return parameter if isinstance(parameter, dict) else {}
        name = str(parameter["$ref"]).rsplit("/", 1)[-1]
        return components.get(name) or {"__missing__": name}

    gaps = []
    for method, path, node, operation in implemented(spec, "hub") + implemented(spec, "edge"):
        template = {segment[1:-1] for segment in path.split("/") if segment.startswith("{") and segment.endswith("}")}
        if not template:
            continue
        declared = set()
        for raw in (node.get("parameters") or []) + (operation.get("parameters") or []):
            parameter = resolve(raw)
            if "__missing__" in parameter:
                gaps.append(f"{method} {path} references missing parameter '{parameter['__missing__']}'")
                continue
            if parameter.get("in") != "path":
                continue
            name = str(parameter.get("name") or "")
            if parameter.get("required") is not True:
                gaps.append(f"{method} {path} path parameter '{name}' must be required: true")
            if "schema" not in parameter and "content" not in parameter:
                gaps.append(f"{method} {path} path parameter '{name}' missing schema")
            declared.add(name)
        for name in sorted(template - declared):
            gaps.append(f"{method} {path} missing path parameter '{name}'")
        for name in sorted(declared - template):
            gaps.append(f"{method} {path} declares unused path parameter '{name}'")
    return sorted(gaps)


def load_baseline() -> list:
    if not os.path.exists(SCHEMA_BASELINE):
        return []
    with open(SCHEMA_BASELINE, encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenAPI <-> hub router route contract gate")
    parser.add_argument("--openapi-path", default="api/openapi.yaml", help="OpenAPI spec path")
    parser.add_argument("--router-path", default="hub-server/internal/router/router.go", help="hub router source path")
    args = parser.parse_args()

    for required in (args.openapi_path, args.router_path):
        if not os.path.exists(required):
            fail(f"required file not found: {required}")

    spec = load_spec(args.openapi_path)
    documented = declared_routes(spec)
    registered = hub_router.routes(args.router_path)

    failures = []
    parameter_gaps = path_parameter_gaps(spec)
    security_gaps = edge_security_gaps(spec)
    missing_routes = sorted(documented - registered)
    undocumented_routes = sorted(registered - documented - ALLOWLIST)

    if parameter_gaps:
        failures.append(f"Path parameters do not match the path template ({len(parameter_gaps)}):")
        failures.extend(f"  ! {gap}" for gap in parameter_gaps)
    if security_gaps:
        failures.append(f"Edge operations missing a security requirement ({len(security_gaps)}):")
        failures.extend(f"  ! {gap}" for gap in security_gaps)
    if missing_routes:
        failures.append(f"OpenAPI documents Hub routes the router does not register ({len(missing_routes)}):")
        failures.extend(f"  + {route}" for route in missing_routes)
    if undocumented_routes:
        failures.append(f"Hub router registers routes missing from OpenAPI ({len(undocumented_routes)}):")
        failures.extend(f"  - {route}" for route in undocumented_routes)

    if failures:
        print("OpenAPI <-> hub router contract drift detected:")
        print(f"  OpenAPI Hub-implemented routes: {len(documented)}")
        print(f"  Router routes: {len(registered)}")
        for line in failures:
            print(line)
        print(
            "\nFix: document router routes in api/openapi.yaml "
            "(x-agenthub-owner: Hub, x-agenthub-status: implemented), or remove stale paths. "
            "Admin/debug-only routes belong in ALLOWLIST in this script."
        )
        return 1

    coverage_gaps = schema_gaps(spec)
    baseline = set(load_baseline())
    new_gaps = [gap for gap in coverage_gaps if gap not in baseline]
    stale = sorted(baseline - set(coverage_gaps))

    if new_gaps:
        print("OpenAPI 2xx schema coverage drift detected (fail-closed):")
        print(f"  Hub-implemented 2xx responses without schema: {len(coverage_gaps)}")
        print(f"  new violations not in baseline: {len(new_gaps)}")
        for gap in new_gaps:
            print(f"  + {gap}")
        print(
            "\nFix: give each Hub-implemented 200/201/202 response a content schema or a $ref to "
            "components/responses. Deliberate exceptions go in scripts/verify/openapi-schema-baseline.json."
        )
        return 1
    if stale:
        print(f"note: {len(stale)} baseline entries are now covered; prune openapi-schema-baseline.json")
        for gap in stale:
            print(f"  ~ {gap}")

    print("openapi<->hub router contract ok")
    print(f"  OpenAPI Hub-implemented routes: {len(documented)}")
    print(f"  Router routes: {len(registered)}")
    print(f"  2xx schema coverage violations: {len(coverage_gaps)} (new: 0)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - fail closed
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
