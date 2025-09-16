export default [
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        window: "readonly",
        document: "readonly",
      },
    },
    ignores: [
      "functions/**/*",
      "packages/**/*",
      "scripts/**/*",
      "terraform/**/*",
      "node_modules/**/*",
    ],
  },
];
