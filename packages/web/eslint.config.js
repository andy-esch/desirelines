import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Base recommended configs
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React Hooks + Compiler (merged in eslint-plugin-react-hooks v7)
  reactHooksPlugin.configs.flat["recommended-latest"],

  // React configuration
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // React rules
      "react/react-in-jsx-scope": "off", // Not needed with new JSX transform
      "react/prop-types": "off", // Using TypeScript for prop validation

      // React Compiler rules — warn for now while codebase is being cleaned up.
      // rules-of-hooks and exhaustive-deps stay at their preset levels (error/warn).
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",

      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // General rules
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Ignore patterns
  {
    ignores: ["build/", "node_modules/", "*.config.js", "*.config.ts", "public/"],
  }
);
