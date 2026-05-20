import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  // Base recommended configs (type-aware)
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Type-aware parser setup — uses tsconfig.json via projectService
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

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
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // Type-aware async/promise safety (from recommendedTypeChecked, pinned
      // here for visibility — these catch real bugs in mutation handlers,
      // event callbacks, and useEffect)
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // Import hygiene
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Catch missing cases on discriminated unions / enums
      "@typescript-eslint/switch-exhaustiveness-check": "error",

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

  // Test files — relax rules that produce noise in test code.
  //   - `no-unsafe-*`: mocks pragmatically use `any` for third-party types
  //   - `no-explicit-any`: test fixtures / `config: {} as any` shortcuts
  //   - `unbound-method`: vitest/jest `expect(mock.method).toHaveBeen...` is safe
  //   - `require-await`: RTL `act(async () => { ... })` without explicit await is idiomatic
  // Real-bug rules (no-floating-promises, no-misused-promises, etc.) remain enforced.
  // Tracked for future full-fix in the project backlog.
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/test/**",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
    },
  },

  // Route files — TanStack Router uses `throw redirect(...)` as a control-flow
  // primitive. The thrown Redirect isn't an Error instance, so
  // `only-throw-error` flags it. Disabling here rather than sprinkling
  // eslint-disable lines through generated-ish route files.
  {
    files: ["src/routes/**"],
    rules: {
      "@typescript-eslint/only-throw-error": "off",
    },
  },

  // Ignore patterns
  {
    ignores: [
      "build/",
      "node_modules/",
      "*.config.js",
      "*.config.ts",
      "public/",
      "coverage/",
    ],
  }
);
