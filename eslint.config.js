import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "live/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["test/**/*.mjs"],
    languageOptions: {
      globals: {
        AbortController: "readonly",
        Buffer: "readonly",
        console: "readonly",
        Headers: "readonly",
        process: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
      },
    },
  },
);
