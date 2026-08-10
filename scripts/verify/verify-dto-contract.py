#!/usr/bin/env python3
"""
verify-dto-contract.py — Three-layer DTO consistency checker.

Compares DTO definitions across:
  1. Go structs (hub-server/internal/model/*.go) — json struct tags
  2. OpenAPI components.schemas (api/openapi.yaml)
  3. TypeScript interfaces (app/shared/src/hubClientDomainTypes.ts, hubClientFrameTypes.ts)
     and event constants (app/shared/src/hubEvents.ts)

Checks:
  A. Frame enum three-set equality:
     Go ws.Frame Type* constants ↔ OpenAPI HubWebSocketFrame.type enum
     ↔ TS HUB_EVENTS constant values.
  B. HubWebSocketFrame.seq_id existence across all three layers
     (Go Frame.SeqID json tag, OpenAPI property, TS HubFrame.seq_id field).
  C. Key DTO field spot-checks for critical schemas (seq_id on message models,
     AgentRunEvent parity, etc.).

Usage:
    python scripts/verify/verify-dto-contract.py

Exit code 0 = PASS (or only warnings), 1 = hard inconsistencies found.
Not wired into CI — run manually or from a local pre-merge check.
"""

from __future__ import annotations

import io
import re
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required (pip install pyyaml)")
    sys.exit(2)

# Force UTF-8 output on Windows GBK consoles.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Path resolution ────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

GO_MODEL_DIR = REPO_ROOT / "hub-server" / "internal" / "model"
GO_WS_FRAME = REPO_ROOT / "hub-server" / "internal" / "ws" / "frame.go"
GO_WORKSPACE_SERVICE = REPO_ROOT / "hub-server" / "internal" / "service" / "workspace" / "service.go"
GO_MESSAGE_TYPES = REPO_ROOT / "hub-server" / "internal" / "service" / "message" / "types.go"
OPENAPI_PATH = REPO_ROOT / "api" / "openapi.yaml"
TS_DOMAIN_TYPES = REPO_ROOT / "app" / "shared" / "src" / "hubClientDomainTypes.ts"
TS_FRAME_TYPES = REPO_ROOT / "app" / "shared" / "src" / "hubClientFrameTypes.ts"
TS_HUB_EVENTS = REPO_ROOT / "app" / "shared" / "src" / "hubEvents.ts"


# ── Go struct JSON tag extraction ─────────────────────────────────

# Matches: FieldName    Type    `gorm:"..." json:"tag_name,omitempty"`
GO_STRUCT_RE = re.compile(
    r"type\s+(\w+)\s+struct\s*\{([^}]*)\}",
    re.DOTALL,
)
GO_FIELD_RE = re.compile(
    r'^\s*(?:[A-Z]\w*)\s+\S+\s+`[^`]*?json:"([^"]+)"',
    re.MULTILINE,
)


def extract_go_struct_json_tags(go_source: str) -> Dict[str, Dict[str, bool]]:
    """Return {struct_name: {json_tag: is_omitempty}} from Go source."""
    structs: Dict[str, Dict[str, bool]] = {}
    for match in GO_STRUCT_RE.finditer(go_source):
        struct_name = match.group(1)
        body = match.group(2)
        fields: Dict[str, bool] = {}
        for field_match in GO_FIELD_RE.finditer(body):
            tag = field_match.group(1)
            # json tag can be "name,omitempty" or just "name"
            parts = tag.split(",")
            json_name = parts[0]
            is_omitempty = len(parts) > 1 and "omitempty" in parts[1]
            if json_name == "-" or json_name == "":
                continue
            fields[json_name] = is_omitempty
        if fields:
            structs[struct_name] = fields
    return structs


def extract_go_frame_constants(go_source: str) -> Set[str]:
    """Extract Type* = "value" constants from frame.go."""
    constants: Set[str] = set()
    # Matches: TypeXxx = "value"
    pattern = re.compile(r'Type\w+\s*=\s*"([^"]+)"')
    for match in pattern.finditer(go_source):
        constants.add(match.group(1))
    return constants


def extract_go_struct_field_tag(
    go_source: str, struct_name: str, field_name: str
) -> str | None:
    """Extract the json tag for a specific field in a specific struct."""
    struct_pattern = re.compile(
        rf"type\s+{re.escape(struct_name)}\s+struct\s*\{{([^}}]*)\}}",
        re.DOTALL,
    )
    match = struct_pattern.search(go_source)
    if not match:
        return None
    body = match.group(1)
    # Find the field by name and extract its json tag.
    field_pattern = re.compile(
        rf'\b{re.escape(field_name)}\b\s+\S+\s+`[^`]*?json:"([^"]+)"'
    )
    field_match = field_pattern.search(body)
    if not field_match:
        return None
    return field_match.group(1).split(",")[0]


# ── OpenAPI schema extraction ──────────────────────────────────────

def load_openapi_schemas() -> Tuple[Dict, Dict]:
    """Return (schemas_dict, raw_yaml) from api/openapi.yaml."""
    text = OPENAPI_PATH.read_text(encoding="utf-8")
    spec = yaml.safe_load(text)
    schemas = spec.get("components", {}).get("schemas", {})
    return schemas, spec


def get_openapi_enum_values(schemas: Dict, schema_name: str, prop: str) -> Set[str]:
    """Get enum values for a property in a schema."""
    schema = schemas.get(schema_name, {})
    props = schema.get("properties", {})
    prop_def = props.get(prop, {})
    enum = prop_def.get("enum", [])
    return set(enum)


def get_openapi_properties(schemas: Dict, schema_name: str) -> Set[str]:
    """Get all property names for a schema."""
    schema = schemas.get(schema_name, {})
    props = schema.get("properties", {})
    return set(props.keys())


# ── TypeScript extraction ──────────────────────────────────────────

def extract_ts_hub_events(ts_source: str) -> Set[str]:
    """Extract HUB_EVENTS constant values from hubEvents.ts."""
    values: Set[str] = set()
    # Matches: KEY: 'value', or KEY: "value",
    pattern = re.compile(r"^\s*\w+:\s*['\"]([^'\"]+)['\"]", re.MULTILINE)
    for match in pattern.finditer(ts_source):
        values.add(match.group(1))
    return values


def extract_ts_interface_fields(ts_source: str, interface_name: str) -> Set[str]:
    """Extract field names from a TS interface."""
    pattern = re.compile(
        rf"export\s+interface\s+{re.escape(interface_name)}\b[^{{]*\{{([^}}]*)\}}",
        re.DOTALL,
    )
    match = pattern.search(ts_source)
    if not match:
        return set()
    body = match.group(1)
    fields: Set[str] = set()
    # Matches: field_name?: type; or field_name: type;
    field_pattern = re.compile(r"^\s*(\w+)\s*[?:]", re.MULTILINE)
    for field_match in field_pattern.finditer(body):
        fields.add(field_match.group(1))
    return fields


# ── Comparison logic ───────────────────────────────────────────────

def check_frame_enum_three_set(
    go_frames: Set[str],
    openapi_enum: Set[str],
    ts_events: Set[str],
) -> List[str]:
    """Verify Go frame constants, OpenAPI enum, and TS HUB_EVENTS are equal."""
    issues: List[str] = []

    go_only = go_frames - openapi_enum
    if go_only:
        issues.append(
            f"  [FAIL] Frame types in Go frame.go but NOT in OpenAPI HubWebSocketFrame enum: {sorted(go_only)}"
        )

    openapi_only = openapi_enum - go_frames
    if openapi_only:
        issues.append(
            f"  [FAIL] Frame types in OpenAPI enum but NOT in Go frame.go: {sorted(openapi_only)}"
        )

    ts_only = ts_events - go_frames
    if ts_only:
        issues.append(
            f"  [FAIL] Frame types in TS HUB_EVENTS but NOT in Go frame.go: {sorted(ts_only)}"
        )

    go_ts_diff = go_frames - ts_events
    if go_ts_diff:
        issues.append(
            f"  [FAIL] Frame types in Go frame.go but NOT in TS HUB_EVENTS: {sorted(go_ts_diff)}"
        )

    if not issues:
        count = len(go_frames)
        issues.append(f"  [OK] Frame enum three-set equality verified ({count} types)")

    return issues


def check_seq_id_existence(
    go_frame_source: str,
    schemas: Dict,
    ts_frame_source: str,
) -> List[str]:
    """Verify seq_id exists in all three layers of HubWebSocketFrame/HubFrame."""
    issues: List[str] = []

    # Go: Frame.SeqID json:"seq_id,omitempty"
    go_tag = extract_go_struct_field_tag(go_frame_source, "Frame", "SeqID")
    if go_tag == "seq_id":
        issues.append("  [OK] Go Frame.SeqID json tag = seq_id")
    else:
        issues.append(
            f"  [FAIL] Go Frame.SeqID json tag expected 'seq_id', got '{go_tag}'"
        )

    # OpenAPI: HubWebSocketFrame.properties.seq_id
    openapi_props = get_openapi_properties(schemas, "HubWebSocketFrame")
    if "seq_id" in openapi_props:
        issues.append("  [OK] OpenAPI HubWebSocketFrame.seq_id property exists")
    else:
        issues.append(
            "  [FAIL] OpenAPI HubWebSocketFrame missing seq_id property"
        )

    # TS: HubFrame.seq_id field
    ts_fields = extract_ts_interface_fields(ts_frame_source, "HubFrame")
    if "seq_id" in ts_fields:
        issues.append("  [OK] TS HubFrame.seq_id field exists")
    else:
        issues.append("  [FAIL] TS HubFrame missing seq_id field")

    return issues


def check_key_dto_fields(schemas: Dict) -> List[str]:
    """Spot-check critical DTO fields in OpenAPI."""
    issues: List[str] = []

    # WorkspaceThreadMessage must have seq_id (Go message.go has it).
    wtm_props = get_openapi_properties(schemas, "WorkspaceThreadMessage")
    if "seq_id" in wtm_props:
        issues.append("  [OK] OpenAPI WorkspaceThreadMessage.seq_id exists")
    else:
        issues.append(
            "  [FAIL] OpenAPI WorkspaceThreadMessage missing seq_id"
        )

    # AgentRunEvent: verify it exists in OpenAPI
    are_props = get_openapi_properties(schemas, "AgentRunEvent")
    if are_props:
        issues.append(
            f"  [OK] OpenAPI AgentRunEvent exists with {len(are_props)} properties"
        )
    else:
        issues.append(
            "  [WARN] OpenAPI AgentRunEvent schema not found (TS has no corresponding type — tracked separately)"
        )

    return issues


def check_go_openapi_property_parity(
    go_structs: Dict[str, Dict[str, bool]],
    schemas: Dict,
) -> List[str]:
    """For key Go structs, verify json tags are present in OpenAPI properties."""
    issues: List[str] = []

    # Map Go struct names to OpenAPI schema names for spot-checks.
    # model.Message (session IM) → openapi Message (session IM projection).
    # workspace.WorkspaceThreadMessage → openapi WorkspaceThreadMessage (web projection).
    # message.MessageResponse (API projection) → openapi Message (must be a superset).
    spot_checks = {
        "AgentRunEvent": "AgentRunEvent",
        "Message": "Message",
        "WorkspaceThreadMessage": "WorkspaceThreadMessage",
        "MessageResponse": "Message",
    }

    for go_name, openapi_name in spot_checks.items():
        go_fields = go_structs.get(go_name)
        if not go_fields:
            issues.append(f"  [WARN] Go struct {go_name} not found in model files")
            continue
        openapi_props = get_openapi_properties(schemas, openapi_name)
        if not openapi_props:
            issues.append(f"  [WARN] OpenAPI schema {openapi_name} not found")
            continue

        # Check Go json tags are a subset of OpenAPI properties.
        missing_in_openapi = set(go_fields.keys()) - openapi_props
        if missing_in_openapi:
            issues.append(
                f"  [FAIL] Go {go_name} json tags missing from OpenAPI {openapi_name}: {sorted(missing_in_openapi)}"
            )
        else:
            issues.append(
                f"  [OK] Go {go_name} json tags ⊆ OpenAPI {openapi_name} ({len(go_fields)} fields)"
            )

    return issues


def check_list_endpoint_bare_array(spec: Dict) -> List[str]:
    """Check E: Verify Hub List endpoints return bare arrays (type: array)
    in their 200 responses, not the {items, page} ListResponse envelope.

    This is a regression guard: Hub List handlers return bare arrays and the
    TS client decodes them as arrays (request<T[]>). If the OpenAPI 200
    response ever regresses to $ref ListResponse, this check will catch it.
    """
    issues: List[str] = []
    # operationId → expected item schema $ref (or "Resource" if generic).
    bare_array_ops = {
        "hubSessions": "Resource",
        "hubListProjectThreads": "WorkspaceThread",
        "hubListProjectThreadMessages": "WorkspaceThreadMessage",
        "hubListAgentTeams": "AgentTeam",
        "hubListTeamRuns": "AgentTeamRun",
        # Session IM messages endpoint also returns a bare array of Message.
        "hubGetMessages": "Message",
    }

    paths = spec.get("paths", {})
    op_index: Dict[str, Tuple[str, str, Dict]] = {}
    for path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        for method, op in methods.items():
            if method == "parameters" or not isinstance(op, dict):
                continue
            op_id = op.get("operationId", "")
            if op_id:
                op_index[op_id] = (path, method, op)

    for op_id, expected_item_schema in bare_array_ops.items():
        entry = op_index.get(op_id)
        if not entry:
            issues.append(f"  [FAIL] operationId {op_id} not found in OpenAPI paths")
            continue
        _path, _method, op = entry
        responses = op.get("responses", {})
        resp_200 = responses.get("200", {})
        # Resolve $ref to the actual response object (responses may be inline or $ref).
        if "$ref" in resp_200:
            issues.append(
                f"  [FAIL] {op_id}: 200 response uses $ref (expected inline bare array schema)"
            )
            continue
        content = resp_200.get("content", {})
        json_content = content.get("application/json", {})
        schema = json_content.get("schema", {})
        schema_type = schema.get("type", "")

        if schema_type != "array":
            issues.append(
                f"  [FAIL] {op_id}: 200 response schema type='{schema_type}', expected 'array'"
            )
            continue

        items = schema.get("items", {})
        item_ref = items.get("$ref", "")
        expected_ref = f"#/components/schemas/{expected_item_schema}"
        if item_ref and item_ref != expected_ref:
            issues.append(
                f"  [FAIL] {op_id}: array items $ref='{item_ref}', expected '{expected_ref}'"
            )
        else:
            issues.append(
                f"  [OK] {op_id}: 200 response is bare array of {expected_item_schema}"
            )

    return issues


# ── Main ───────────────────────────────────────────────────────────

def main() -> int:
    issues: List[str] = []
    has_hard_failure = False

    # ── Load sources ──
    if not GO_WS_FRAME.exists():
        print(f"ERROR: {GO_WS_FRAME} not found")
        return 2
    if not OPENAPI_PATH.exists():
        print(f"ERROR: {OPENAPI_PATH} not found")
        return 2
    if not TS_HUB_EVENTS.exists():
        print(f"ERROR: {TS_HUB_EVENTS} not found")
        return 2

    go_frame_source = GO_WS_FRAME.read_text(encoding="utf-8")
    ts_events_source = TS_HUB_EVENTS.read_text(encoding="utf-8")
    ts_frame_source = (
        TS_FRAME_TYPES.read_text(encoding="utf-8")
        if TS_FRAME_TYPES.exists()
        else ""
    )
    schemas, spec = load_openapi_schemas()

    # Load all Go model structs for property parity checks.
    go_structs: Dict[str, Dict[str, bool]] = {}
    if GO_MODEL_DIR.exists():
        for go_file in GO_MODEL_DIR.glob("*.go"):
            if go_file.name.endswith("_test.go"):
                continue
            source = go_file.read_text(encoding="utf-8")
            go_structs.update(extract_go_struct_json_tags(source))

    # Also load service-layer DTO structs used by Check D spot-checks:
    # workspace.WorkspaceThreadMessage (web message projection) and
    # message.MessageResponse (session IM API projection). These live
    # outside internal/model, so they are loaded explicitly here.
    for go_file in (GO_WORKSPACE_SERVICE, GO_MESSAGE_TYPES):
        if go_file.exists():
            source = go_file.read_text(encoding="utf-8")
            go_structs.update(extract_go_struct_json_tags(source))

    # ── Check A: Frame enum three-set equality ──
    print("─" * 60)
    print("Check A: Frame enum three-set equality")
    print("  (Go frame.go <-> OpenAPI HubWebSocketFrame.type <-> TS HUB_EVENTS)")
    print("─" * 60)
    go_frames = extract_go_frame_constants(go_frame_source)
    openapi_enum = get_openapi_enum_values(schemas, "HubWebSocketFrame", "type")
    ts_events = extract_ts_hub_events(ts_events_source)
    results_a = check_frame_enum_three_set(go_frames, openapi_enum, ts_events)
    for line in results_a:
        print(line)
        if "[FAIL]" in line:
            has_hard_failure = True
    issues.extend(results_a)

    # ── Check B: seq_id existence ──
    print()
    print("─" * 60)
    print("Check B: HubWebSocketFrame.seq_id existence (three layers)")
    print("─" * 60)
    results_b = check_seq_id_existence(go_frame_source, schemas, ts_frame_source)
    for line in results_b:
        print(line)
        if "[FAIL]" in line:
            has_hard_failure = True
    issues.extend(results_b)

    # ── Check C: Key DTO field spot-checks ──
    print()
    print("─" * 60)
    print("Check C: Key DTO field spot-checks")
    print("─" * 60)
    results_c = check_key_dto_fields(schemas)
    for line in results_c:
        print(line)
        if "[FAIL]" in line:
            has_hard_failure = True
    issues.extend(results_c)

    # ── Check D: Go ↔ OpenAPI property parity ──
    print()
    print("─" * 60)
    print("Check D: Go json tags ⊆ OpenAPI properties (spot-check)")
    print("─" * 60)
    results_d = check_go_openapi_property_parity(go_structs, schemas)
    for line in results_d:
        print(line)
        if "[FAIL]" in line:
            has_hard_failure = True
    issues.extend(results_d)

    # ── Check E: List endpoint response shape (bare array, not {items,page}) ──
    print()
    print("─" * 60)
    print("Check E: List endpoint response shape = bare array")
    print("  (prevents {items,page} envelope regression on Hub List handlers)")
    print("─" * 60)
    results_e = check_list_endpoint_bare_array(spec)
    for line in results_e:
        print(line)
        if "[FAIL]" in line:
            has_hard_failure = True
    issues.extend(results_e)

    # ── Summary ──
    print()
    print("─" * 60)
    fails = [i for i in issues if "[FAIL]" in i]
    warns = [i for i in issues if "[WARN]" in i]
    oks = [i for i in issues if "[OK]" in i]
    print(f"Summary: {len(oks)} OK, {len(warns)} warnings, {len(fails)} failures")
    if has_hard_failure:
        print("RESULT: FAIL — DTO contract inconsistencies found")
        return 1
    print("RESULT: PASS — DTO contract consistent (or only warnings)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
