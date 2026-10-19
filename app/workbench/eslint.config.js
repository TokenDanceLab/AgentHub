import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Workbench is the shell layer above shared, so it carries the same enforced
// policy as shared/eslint.config.js: `X | void` callback unions and non-null
// assertions stay warnings (their removal would be an API-wide refactor),
// while real defects (unused bindings, wrong hook usage) block.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Failure paths surface to the user through console.error/warn; stray
      // logging is still rejected.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-invalid-void-type": ["warn", { allowInGenericTypeArguments: true }],
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/__tests__/**", "**/*.test.*", "**/*.stories.*"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
