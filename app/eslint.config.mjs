import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/pnpm-lock.yaml"] },

  // Base TypeScript config
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": { typescript: true },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // eslint-plugin-import order currently crashes under ESLint 10 on the RN package.
  {
    files: ["mobile-rn/**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "import/order": "off",
    },
  },

  // 依赖方向门禁（#1759）：shared 是跨端原语层，永远不得 import workbench
  // 包（workbench → shared 单向）。相对路径越界由
  // scripts/verify/verify-frontend-package-boundary.py 兜底。
  {
    files: ["shared/**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@agenthub/workbench", "@agenthub/workbench/*", "@workbench", "@workbench/*"],
              message:
                "shared must never import workbench — dependency direction is workbench -> shared only (#1759).",
            },
          ],
        },
      ],
    },
  },

  // React Hooks rules — only for UI packages
  {
    files: ["desktop/**/*.{tsx,jsx}", "web/**/*.{tsx,jsx}", "mobile-rn/**/*.{tsx,jsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Relax rules for test files
  {
    files: ["**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/e2e/**"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);
