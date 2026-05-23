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
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "type",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
  },

  // React Hooks rules — only for UI packages
  {
    files: ["desktop/**/*.{tsx,jsx}", "web/**/*.{tsx,jsx}"],
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
