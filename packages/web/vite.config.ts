import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "child_process";

// Get git commit hash for versioning
let commitHash = "unknown";
try {
  commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  console.warn("Could not determine git commit hash");
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env files for the current mode
  // This loads .env, .env.local, .env.[mode], .env.[mode].local
  const env = loadEnv(mode, process.cwd(), "");

  // Validate critical environment variables at build time
  // This catches missing config before deployment
  // Skip validation explicitly (set SKIP_ENV_VALIDATION=true)
  const skipValidation = env.SKIP_ENV_VALIDATION === "true";

  if (mode === "production" && !skipValidation) {
    const requiredVars = [
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_API_GATEWAY_URL",
    ];

    const missing = requiredVars.filter((key) => !env[key] || env[key] === "");

    if (missing.length > 0) {
      throw new Error(
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Build-Time Configuration Validation Failed\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Missing required environment variables for production build:\n\n` +
          missing.map((v) => `  • ${v}`).join("\n") +
          "\n\n" +
          `Create .env.production.local with your credentials (see README.md)\n` +
          `To skip validation (e.g., in CI), set SKIP_ENV_VALIDATION=true\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
      );
    }

    console.log("✓ Production build configuration validated");
  } else if (mode === "production" && skipValidation) {
    console.log("⚠ Production build validation skipped (SKIP_ENV_VALIDATION=true)");
  }

  // Allow overriding via env var (useful for CI)
  const version = env.VITE_GIT_COMMIT || commitHash;

  // Vendor chunks — cached separately from app code.
  // Each group contains libraries that update on a similar cadence.
  const vendorChunks: Record<string, string[]> = {
    "react-vendor": ["react", "react-dom", "@tanstack/react-router"],
    "firebase-vendor": ["firebase/app", "firebase/auth", "firebase/firestore"],
    "chart-vendor": ["recharts"],
    "query-vendor": ["@tanstack/react-query"],
    "headlessui-vendor": ["@headlessui/react"],
    "zod-vendor": ["zod"],
  };

  return {
    define: {
      __COMMIT_HASH__: JSON.stringify(version),
    },
    plugins: [
      TanStackRouterVite({ quoteStyle: "double", semicolons: true }),
      tailwindcss(),
      react({
        babel: {
          plugins: ["babel-plugin-react-compiler"],
        },
      }),
    ],
    server: {
      port: 3000,
      host: true, // Needed for Docker
    },
    build: {
      outDir: "build", // Keep same output dir for compatibility
      sourcemap: mode === "production" ? "hidden" : true,
      rolldownOptions: {
        output: {
          manualChunks(id) {
            for (const [chunk, deps] of Object.entries(vendorChunks)) {
              if (
                deps.some((dep) => {
                  const segment = `node_modules/${dep}`;
                  const i = id.indexOf(segment);
                  if (i === -1) return false;
                  const next = id[i + segment.length];
                  return next === "/" || next === undefined;
                })
              ) {
                return chunk;
              }
            }
          },
        },
      },
    },
    envPrefix: "VITE_",
    test: {
      globals: true,
      environment: "jsdom", // DOM environment for React component testing
      setupFiles: "./src/test/setup.ts",
      css: true, // Support CSS imports in tests
      // Exclude integration tests from regular test runs
      exclude: ["**/*.integration.test.{ts,tsx}", "node_modules/**"],
      // Memory optimization: limit parallel workers to reduce memory pressure
      // Each worker spawns its own JSDOM environment which is memory-intensive
      pool: "forks",
      maxWorkers: 3, // Limit to 3 workers (adjust based on available RAM)
      minWorkers: 1,
      isolate: true, // Isolate tests for cleaner memory
      // Reduce memory by not keeping test results in memory
      reporters: ["default"],
      // Fail fast on memory issues
      bail: 1,
      // Force exit after tests complete to prevent hanging from open handles
      // (e.g., Firebase auth polling, unresolved promises)
      teardownTimeout: 5000,
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html", "lcov"],
        exclude: [
          "node_modules/",
          "src/test/setup.ts",
          "src/test/integration-setup.ts",
          "**/*.test.{ts,tsx}",
          "**/*.spec.{ts,tsx}",
          "**/*.integration.test.{ts,tsx}",
          "vite.config.ts",
          "vitest.integration.config.ts",
          // Exclude generated protobuf code - machine-generated, tested via usage
          "src/types/generated/**",
        ],
      },
    },
  };
});
