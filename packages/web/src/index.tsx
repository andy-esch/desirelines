import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { loadConfig } from "./lib/config";

// Log version for debugging
console.log(
  `%c Desirelines %c ${__COMMIT_HASH__} `,
  "background: #35495e; color: #fff; border-radius: 3px 0 0 3px; padding: 2px 5px;",
  "background: #41b883; color: #fff; border-radius: 0 3px 3px 0; padding: 2px 5px;"
);

// Expose version on window for easy checking in browser console
window.DESIRELINES_VERSION = __COMMIT_HASH__;

// Validate configuration before rendering the app
// This catches config errors early with clear messages
try {
  loadConfig();
} catch (error) {
  // Configuration is invalid - show error to user
  console.error("Failed to load application configuration:", error);

  const root = document.getElementById("root");
  if (root) {
    const container = document.createElement("div");
    container.style.cssText =
      "padding: 40px; font-family: monospace; max-width: 800px; margin: 0 auto;";

    const heading = document.createElement("h1");
    heading.style.color = "#d32f2f";
    heading.textContent = "Configuration Error";

    const description = document.createElement("p");
    description.style.cssText = "font-size: 16px; line-height: 1.6;";
    description.textContent = "The application failed to start due to invalid configuration.";

    const pre = document.createElement("pre");
    pre.style.cssText =
      "background: #f5f5f5; padding: 20px; border-radius: 4px; overflow-x: auto; font-size: 14px;";
    pre.textContent = error instanceof Error ? error.message : String(error);

    const hint = document.createElement("p");
    hint.style.cssText = "margin-top: 20px; color: #666;";
    hint.textContent =
      "This usually means environment variables are missing or invalid. Check the console for more details.";

    container.append(heading, description, pre, hint);
    root.replaceChildren(container);
  }
  throw error; // Re-throw to prevent app from continuing
}

// Lazy-load React Query devtools (only loaded in development)
const ReactQueryDevtools = lazy(() =>
  import("@tanstack/react-query-devtools").then((mod) => ({
    default: mod.ReactQueryDevtools,
  }))
);

function DevtoolsLazy() {
  return (
    <Suspense fallback={null}>
      <ReactQueryDevtools initialIsOpen={false} />
    </Suspense>
  );
}

// Initialize React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false, // Prevents excessive refetching
      staleTime: 5 * 60 * 1000, // 5 minutes stale time default
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        {import.meta.env.DEV && <DevtoolsLazy />}
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
