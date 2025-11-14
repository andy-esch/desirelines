import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env files for the current mode
  // This loads .env, .env.local, .env.[mode], .env.[mode].local
  const env = loadEnv(mode, process.cwd(), '');

  // Validate critical environment variables at build time
  // This catches missing config before deployment
  // Skip validation in CI environments (set SKIP_ENV_VALIDATION=true)
  const skipValidation = env.SKIP_ENV_VALIDATION === 'true' || env.CI === 'true';

  if (mode === 'production' && !skipValidation) {
    const requiredVars = [
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_API_GATEWAY_URL',
    ];

    const missing = requiredVars.filter(
      (key) => !env[key] || env[key] === ''
    );

    if (missing.length > 0) {
      throw new Error(
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Build-Time Configuration Validation Failed\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Missing required environment variables for production build:\n\n` +
        missing.map(v => `  • ${v}`).join('\n') + '\n\n' +
        `Create .env.production.local with your credentials (see README.md)\n` +
        `To skip validation (e.g., in CI), set SKIP_ENV_VALIDATION=true\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
      );
    }

    console.log('✓ Production build configuration validated');
  } else if (mode === 'production' && skipValidation) {
    console.log('⚠ Production build validation skipped (CI mode)');
  }

  return {
    plugins: [react()],
    server: {
      port: 3000,
      host: true, // Needed for Docker
    },
    build: {
      outDir: "build", // Keep same output dir for compatibility
    },
    envPrefix: ["VITE_", "REACT_APP_"], // Support both Vite and React env var prefixes
    test: {
      globals: true,
      environment: "jsdom", // DOM environment for React component testing
      setupFiles: "./src/test/setup.ts",
      css: true, // Support CSS imports in tests
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html", "lcov"],
        exclude: [
          "node_modules/",
          "src/test/setup.ts",
          "**/*.test.{ts,tsx}",
          "**/*.spec.{ts,tsx}",
          "vite.config.ts",
          // Exclude generated protobuf code - machine-generated, tested via usage
          "src/types/generated/**",
        ],
      },
    },
  };
});
