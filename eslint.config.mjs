import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

/**
 * ESLint flat config.
 *
 * `next/core-web-vitals` + TypeScript rules. Architecture boundary rules
 * (e.g. "domain must not import infrastructure") are intentionally left
 * as a TODO for `eslint-plugin-boundaries` once modules exist — see
 * docs/ARCHITECTURE.md.
 */
const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**"],
  },
];

export default eslintConfig;
