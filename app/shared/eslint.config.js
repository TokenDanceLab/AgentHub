import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Mirrors web/eslint.config.js: shared is consumed by web/desktop/mobile and
// follows the same enforced policy — non-null assertion as warning (callers
// own nullability), void-type generic arguments allowed, tests relaxed.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The shared callback API deliberately uses `X | void` unions (callers
      // may return undefined). Changing them to `| undefined` would be an
      // API-breaking refactor across desktop/web/mobile consumers, so the
      // pattern is tracked as a warning instead of an error.
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
    files: ["**/__tests__/**", "**/*.test.*"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
