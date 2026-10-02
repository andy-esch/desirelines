import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorState } from "../ErrorState";
import { Panel } from "../theme/Panel";

/**
 * A safety net around a self-contained dashboard card: one that fetches its own data and
 * shows its own loading, error and empty states. If the card throws while rendering, a
 * danger-toned panel takes its place, with Retry to render it again, and the rest of the
 * dashboard carries on.
 *
 * Not for a chart whose parent holds its loading and error state: `ChartContainer` shows
 * those, and guards its own chart.
 */
export function CardErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <Panel tone="danger" className="h-full">
          <ErrorState title="Error displaying this card" onRetry={resetErrorBoundary}>
            {error instanceof Error ? error.message : String(error)}
          </ErrorState>
        </Panel>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
