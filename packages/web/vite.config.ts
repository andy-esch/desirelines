import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
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
    environment: "node", // Just for utilities, not components yet
  },
});
