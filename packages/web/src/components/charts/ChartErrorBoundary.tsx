/**
 * ChartErrorBoundary - catches render-time exceptions from a self-contained
 * chart card and shows the standard chart error UI.
 *
 * Use this when the child owns its own data fetching, so the parent has no
 * loading/error/empty state to speak of and only needs a safety net around the
 * render.
 *
 * Not interchangeable with `ChartContainer`. That component is for the opposite
 * arrangement — a parent that *holds* `isLoading` / `error` / `isEmpty` and
 * passes them down, getting the spinner, error, empty, and header treatments in
 * return. Handing it a self-fetching child would mean inventing state it does
 * not have.
 */
import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import ErrorChart from "./ErrorChart";

interface ChartErrorBoundaryProps {
  /** The chart card to guard. */
  children: ReactNode;
  /** Optional retry handler forwarded to the error UI. */
  onRetry?: (() => void) | undefined;
}

export function ChartErrorBoundary({ children, onRetry }: ChartErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackRender={({ error }) => <ErrorChart error={error as Error} onRetry={onRetry} />}
    >
      {children}
    </ErrorBoundary>
  );
}

export default ChartErrorBoundary;
