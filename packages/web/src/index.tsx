// Must stay first: validates the configuration before any module that reads it.
import "./configCheck";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "react-error-boundary";
import { PageErrorFallback } from "./components/PageErrorFallback";
import { createAppRouter } from "./router";
import { logger } from "./lib/logger";
import { installGlobalErrorHandlers } from "./lib/global-error-handlers";
import { preloadThemeFonts } from "./themes/fontPreloads";
import { redactAuthorizationHeader } from "./api/errors";
import { moveLegacyDemoStorage } from "./services/demoStorage";

// Catch errors outside the React tree (timers, non-React scripts,
// unhandled promise rejections). React-rendering errors are caught
// by the <ErrorBoundary> below.
installGlobalErrorHandlers();

// Demo data lives under its own `demo.` keys; move it from the keys it used before, once.
moveLegacyDemoStorage();

// Ask for the active theme's faces as early as the app can, so headlines don't paint in
// the fallback face first. The first-paint script has already set `data-theme`.
preloadThemeFonts(document);

// Log version for debugging
logger.info(
  `%c Desirelines %c ${__COMMIT_HASH__} `,
  "background: #35495e; color: #fff; border-radius: 3px 0 0 3px; padding: 2px 5px;",
  "background: #41b883; color: #fff; border-radius: 0 3px 3px 0; padding: 2px 5px;"
);

// Expose version on window for easy checking in browser console
window.DESIRELINES_VERSION = __COMMIT_HASH__;

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

// Create router instance
const router = createAppRouter();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary
      onError={(error, info) => {
        redactAuthorizationHeader(error);
        logger.error("React ErrorBoundary caught error", {
          error,
          componentStack: info.componentStack,
        });
      }}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <PageErrorFallback
          error={error instanceof Error ? error : new Error(String(error))}
          onReset={resetErrorBoundary}
          variant="full"
        />
      )}
    >
      <QueryClientProvider client={queryClient}>
        <App router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
