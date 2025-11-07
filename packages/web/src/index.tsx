import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { loadConfig } from "./lib/config";

// Validate configuration before rendering the app
// This catches config errors early with clear messages
try {
  loadConfig();
} catch (error) {
  // Configuration is invalid - show error to user
  console.error("Failed to load application configuration:", error);

  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <div style="padding: 40px; font-family: monospace; max-width: 800px; margin: 0 auto;">
        <h1 style="color: #d32f2f;">⚠️ Configuration Error</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          The application failed to start due to invalid configuration.
        </p>
        <pre style="background: #f5f5f5; padding: 20px; border-radius: 4px; overflow-x: auto; font-size: 14px;">
${error instanceof Error ? error.message : String(error)}</pre>
        <p style="margin-top: 20px; color: #666;">
          This usually means environment variables are missing or invalid.
          Check the console for more details.
        </p>
      </div>
    `;
  }
  throw error; // Re-throw to prevent app from continuing
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
