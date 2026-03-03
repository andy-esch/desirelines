import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  // Base recommended configs
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React Hooks + Compiler (merged in eslint-plugin-react-hooks v7)
  reactHooksPlugin.configs.flat["recommended-latest"],

  // Accessibility
  jsxA11yPlugin.flatConfigs.recommended,

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

      // React Compiler rules — warn while remaining violations are cleaned up.
      // Remaining: GoalManagementTable and isFirstRender/localSelectionRef
      // tradeoffs in chart components. Promote to error once these are resolved.
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",

      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // Accessibility rule overrides
      // label-has-associated-control: Our StyledSelect (Headless UI Listbox) is a
      // custom component the rule doesn't recognize as a form control. Listing it
      // in controlComponents lets htmlFor/id association work across the boundary.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { controlComponents: ["StyledSelect"] },
      ],
      // no-noninteractive-tabindex: Allow tabIndex on elements with role="note"
      // (used for focusable disabled-button tooltips in SportVisibilitySettings).
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { roles: ["note"], allowExpressionValues: true },
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
