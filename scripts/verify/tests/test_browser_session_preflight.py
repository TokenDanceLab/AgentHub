"""Execute the real-lane preflight against the browser wire contract."""
import io
import json
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest.mock import patch


class BrowserSessionPreflightTests(unittest.TestCase):
    def test_preflight_does_not_use_retired_web_bearer_lane(self):
        repo = Path(__file__).resolve().parents[3]
        script = (repo / "scripts/e2e/provision-real-e2e-stack.sh").read_text()
        source = script.split("python3 - <<'PYEOF'\n", 1)[1].split("\nPYEOF", 1)[0]
        issuer = "https://account.example.test"
        web = "https://hub.example.test"
        callback = web + "/workbench/auth/account/callback"
        requests = []
        discovery = {
            "issuer": issuer,
            **{key: issuer + path for key, path in {
                "authorization_endpoint": "/oauth/authorize",
                "token_endpoint": "/oauth/token",
                "userinfo_endpoint": "/oauth/userinfo",
                "jwks_uri": "/oauth/jwks",
            }.items()},
            "response_types_supported": ["code"],
            "response_modes_supported": ["query"],
            "grant_types_supported": ["authorization_code"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["client_secret_basic"],
            "authorization_response_iss_parameter_supported": True,
        }

        def respond(request, **_):
            path = urllib.parse.urlsplit(request.full_url).path
            requests.append(path)
            if path == "/.well-known/openid-configuration":
                body = discovery
            elif path == "/oauth/jwks":
                body = {"keys": [{"kty": "RSA"}]}
            else:
                self.assertEqual(request.get_header("Origin"), web)
                self.assertEqual(request.get_header("Host"), "hub.example.test")
                payload = json.loads(request.data)
                if path == "/client/auth/browser/authorize":
                    self.assertEqual(set(payload), {"device_id"})
                    query = {
                        "response_type": "code", "scope": "openid profile",
                        "redirect_uri": callback, "code_challenge_method": "S256",
                        "prompt": "consent", "client_id": "client", "state": "state",
                        "nonce": "nonce", "code_challenge": "server-owned-challenge",
                    }
                    body = {"data": {"issuer": issuer, "state": "state",
                        "authorization_url": issuer + "/oauth/authorize?" + urllib.parse.urlencode(query)}}
                elif path == "/client/auth/browser/callback":
                    self.assertEqual(set(payload), {"code", "state"})
                    raise urllib.error.HTTPError(request.full_url, 400, "missing issuer", {}, None)
                else:
                    self.fail("unexpected endpoint: " + path)
            return io.BytesIO(json.dumps(body).encode())

        with patch.dict("os.environ", {"ACCOUNT_ISSUER": issuer, "HUB_BASE_URL": web, "WEB_CALLBACK_URL": callback}), \
                patch("urllib.request.urlopen", side_effect=respond), patch("sys.stdout", new_callable=io.StringIO):
            exec(compile(source, "browser-preflight", "exec"), {})
        self.assertEqual(requests[-2:], ["/client/auth/browser/authorize", "/client/auth/browser/callback"])


if __name__ == "__main__":
    unittest.main()
