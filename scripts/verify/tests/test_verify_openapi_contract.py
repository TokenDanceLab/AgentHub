#!/usr/bin/env python3
"""Self-tests for the OpenAPI Edge security and path-parameter checks."""

import os
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER = os.path.join(REPO_ROOT, "scripts", "verify", "verify-openapi-contract.py")

SPEC = """\
openapi: 3.0.3
info: {title: fixture, version: "1"}
paths:
  /v1/runs:
    post:
      operationId: createRun
      x-agenthub-owner: Edge
      x-agenthub-status: implemented
__SECURITY__      responses:
        "200": {description: ok}
components:
  securitySchemes:
    edgeBearerAuth: {type: http, scheme: bearer}
    edgeLocalToken: {type: apiKey, in: header, name: X-AgentHub-Edge-Token}
    edgeWebSocketProtocol: {type: apiKey, in: header, name: Sec-WebSocket-Protocol}
"""

ROUTER = "package router\n"


def run_verifier(spec_text):
    with tempfile.TemporaryDirectory(prefix="agenthub-openapi-security-") as tmp:
        spec_path = os.path.join(tmp, "openapi.yaml")
        router_path = os.path.join(tmp, "router.go")
        with open(spec_path, "w", encoding="utf-8") as handle:
            handle.write(spec_text)
        with open(router_path, "w", encoding="utf-8") as handle:
            handle.write(ROUTER)
        result = subprocess.run(
            [sys.executable, VERIFIER, "--openapi-path", spec_path, "--router-path", router_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, (result.stdout or "") + (result.stderr or "")


class EdgeSecurityTests(unittest.TestCase):
    def test_missing_security_fails(self):
        code, output = run_verifier(SPEC.replace("__SECURITY__", ""))
        self.assertNotEqual(code, 0, f"missing Edge security must fail:\n{output}")
        self.assertIn("missing a security requirement", output)

    def test_anonymous_requirement_fails(self):
        security = "      security: [{}]\n"
        code, output = run_verifier(SPEC.replace("__SECURITY__", security))
        self.assertNotEqual(code, 0, f"empty security requirement must fail:\n{output}")
        self.assertIn("missing a security requirement", output)

    def test_declared_security_passes(self):
        security = "      security:\n        - edgeBearerAuth: []\n"
        code, output = run_verifier(SPEC.replace("__SECURITY__", security))
        self.assertEqual(code, 0, f"declared Edge security must pass:\n{output}")

    def test_unknown_security_scheme_fails(self):
        security = "      security:\n        - edgeBearAuth: []\n"
        code, output = run_verifier(SPEC.replace("__SECURITY__", security))
        self.assertNotEqual(code, 0, f"undefined security scheme must fail:\n{output}")
        self.assertIn("unknown security scheme 'edgeBearAuth'", output)

    def test_null_requirement_fails(self):
        code, output = run_verifier(SPEC.replace("__SECURITY__", "      security: [null]\n"))
        self.assertNotEqual(code, 0, f"null security requirement must fail:\n{output}")
        self.assertIn("missing a security requirement", output)

    def test_empty_list_requirement_fails(self):
        code, output = run_verifier(SPEC.replace("__SECURITY__", "      security: [[]]\n"))
        self.assertNotEqual(code, 0, f"empty-list security requirement must fail:\n{output}")
        self.assertIn("missing a security requirement", output)

    def test_lowercase_hub_owner_is_recognized(self):
        spec = SPEC.replace("x-agenthub-owner: Edge", "x-agenthub-owner: hub")
        spec = spec.replace("__SECURITY__", "      security:\n        - edgeBearerAuth: []\n")
        code, output = run_verifier(spec)
        self.assertNotEqual(code, 0, f"Hub route absent from router must fail:\n{output}")
        self.assertIn("+ POST /v1/runs", output)


PARAM_SPEC = """openapi: 3.0.3
info: {title: fixture, version: "1"}
paths:
  /client/contacts/{user_id}:
    delete:
      operationId: removeContact
      x-agenthub-owner: Edge
      x-agenthub-status: implemented
      security: [{edgeBearerAuth: []}]
      parameters:
        - $ref: "#/components/parameters/__PARAM__"
      responses:
        "204": {description: removed}
components:
  securitySchemes:
    edgeBearerAuth: {type: http, scheme: bearer}
  parameters:
    UserId:
      name: userId
      in: path
      required: true
      schema: {type: string}
    ContactUserId:
      name: user_id
      in: path
      required: true
      schema: {type: string}
    RequiredFalse:
      name: user_id
      in: path
      required: false
      schema: {type: string}
    NoSchema:
      name: user_id
      in: path
      required: true
    UnusedParam:
      name: other_id
      in: path
      required: true
      schema: {type: string}
"""


class PathParameterTests(unittest.TestCase):
    def test_mismatched_parameter_name_fails(self):
        code, output = run_verifier(PARAM_SPEC.replace("__PARAM__", "UserId"))
        self.assertNotEqual(code, 0, f"path parameter mismatch must fail:\n{output}")
        self.assertIn("missing path parameter 'user_id'", output)

    def test_matching_parameter_name_passes(self):
        code, output = run_verifier(PARAM_SPEC.replace("__PARAM__", "ContactUserId"))
        self.assertEqual(code, 0, f"matching path parameter must pass:\n{output}")

    def test_optional_path_parameter_fails(self):
        code, output = run_verifier(PARAM_SPEC.replace("__PARAM__", "RequiredFalse"))
        self.assertNotEqual(code, 0, f"optional path parameter must fail:\n{output}")
        self.assertIn("must be required: true", output)

    def test_path_parameter_without_schema_fails(self):
        code, output = run_verifier(PARAM_SPEC.replace("__PARAM__", "NoSchema"))
        self.assertNotEqual(code, 0, f"path parameter without schema must fail:\n{output}")
        self.assertIn("missing schema", output)

    def test_missing_parameter_ref_fails(self):
        code, output = run_verifier(PARAM_SPEC.replace("__PARAM__", "Missing"))
        self.assertNotEqual(code, 0, f"dangling parameter $ref must fail:\n{output}")
        self.assertIn("references missing parameter 'Missing'", output)

    def test_unused_path_parameter_fails(self):
        code, output = run_verifier(PARAM_SPEC.replace("__PARAM__", "UnusedParam"))
        self.assertNotEqual(code, 0, f"unused path parameter must fail:\n{output}")
        self.assertIn("declares unused path parameter 'other_id'", output)


if __name__ == "__main__":
    unittest.main()
