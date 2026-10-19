// Fast, blocking boundary gate for the shared/workbench/web/mobile packages.
// It deliberately does not load the full strict ruleset: those have existing
// debt, while these import/literal rules are the architectural contract.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const presentationImports = [
  {
    group: ["**/eventClient*", "**/edgeClient*", "**/apiClient*"],
    message: "Presentation code must not import a Local Edge client; inject a narrow port instead.",
  },
  {
    group: ["**/hubClient*", "@shared/hub/hubClient*"],
    message: "Presentation code must not depend on hubClient; inject a narrow port instead.",
  },
];

const edgeLiterals = [
  {
    selector: "Literal[value=/127\\.0\\.0\\.1:3210|localhost:3210/]",
    message: "Hub-only code must not target the Local Edge loopback port.",
  },
  {
    selector: "Literal[value=/\\/v1\\/(events|runs)/]",
    message: "Hub-only code must not call the Local Edge event/run API.",
  },
];

export default tseslint.config(
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["shared/src/**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...presentationImports,
            {
              group: [
                "@agenthub/workbench",
                "@agenthub/workbench/*",
                "@workbench",
                "@workbench/*",
                "**/workbench/**",
              ],
              message: "shared must never import workbench — dependency direction is workbench -> shared only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["workbench/src/**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...presentationImports,
            {
              group: [
                "agenthub-desktop",
                "agenthub-desktop/*",
                "agenthub-web",
                "agenthub-web/*",
                "agenthub-mobile-rn",
                "agenthub-mobile-rn/*",
                "**/desktop/**",
                "**/web/**",
                "**/mobile-rn/**",
              ],
              message: "workbench must not import a platform package.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/eventClient*", "**/edgeClient*"],
              message: "Web and Mobile are Hub-only; they must not import a Local Edge client.",
            },
            {
              group: ["@tauri-apps/*", "**/src-tauri/*"],
              message: "Tauri is Desktop-only.",
            },
          ],
        },
      ],
    },
  },
  {
    // Mobile is Hub-only React Native: no DOM, no Tauri, no CSS modules, and
    // only the RN-safe shared entry points.
    files: ["mobile-rn/src/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/eventClient*", "**/edgeClient*"],
              message: "Web and Mobile are Hub-only; they must not import a Local Edge client.",
            },
            {
              group: ["@tauri-apps/*", "**/src-tauri/*", "react-dom", "react-dom/*"],
              message: "Tauri and react-dom are not part of the React Native runtime.",
            },
            {
              group: ["**/*.module.css", "@agenthub/shared/ui", "@agenthub/shared/ui/*"],
              message: "Mobile does not bundle web UI or CSS modules; use RN components.",
            },
            {
              group: ["@agenthub/workbench", "@agenthub/workbench/*", "@agenthub/shared/workbench", "@agenthub/shared/workbench/*"],
              message: "Workbench is Desktop/Web-only; Mobile stays Hub-only.",
            },
            {
              group: ["child_process", "node:child_process"],
              message: "Mobile runtime must not spawn processes.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "shared/src/**/*.{ts,tsx,js,jsx,mjs}",
      "workbench/src/**/*.{ts,tsx,js,jsx,mjs}",
      "web/src/**/*.{ts,tsx,js,jsx,mjs}",
      "mobile-rn/src/**/*.{ts,tsx,js,jsx,mjs}",
    ],
    ignores: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"],
    rules: {
      "no-restricted-syntax": ["error", ...edgeLiterals],
    },
  },
  {
    // Mobile runtime hygiene (supersedes the shared block above for mobile).
    // Test doubles and the Hub auth/session modules legitimately handle token
    // field names and SecureStore; everything else stays DOM- and token-free.
    files: ["mobile-rn/src/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "mobile-rn/src/api/hubClient.ts",
      "mobile-rn/src/session/mobileAuthSession.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...edgeLiterals,
        {
          selector: "Identifier[name=/^(localStorage|sessionStorage)$/]",
          message: "React Native has no web storage; use SecureStore.",
        },
        {
          selector: "MemberExpression[object.name=/^(document|window)$/]",
          message: "React Native has no DOM; use RN APIs.",
        },
        {
          selector:
            "Identifier[name=/^(access_token|id_token|client_secret|providerAccessToken)$/]",
          message: "Mobile runtime must not handle raw token fields; use the Hub session port.",
        },
        {
          selector:
            "Property[key.value=/^(access_token|id_token|client_secret|providerAccessToken)$/]",
          message: "Mobile runtime must not handle raw token fields; use the Hub session port.",
        },
        {
          selector:
            "MemberExpression[property.value=/^(access_token|id_token|client_secret|providerAccessToken)$/]",
          message: "Mobile runtime must not handle raw token fields; use the Hub session port.",
        },
      ],
    },
  }
);
