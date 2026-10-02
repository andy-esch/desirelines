import { Link } from "@tanstack/react-router";
import { buttonVariants } from "./ui/button";
import { ErrorState } from "./ErrorState";
import { Panel } from "./theme/Panel";

type ErrorFallbackVariant = "page" | "inline" | "full";

interface PageErrorFallbackProps {
  error: unknown;
  onReset?: (() => void) | undefined;
  /** @default "page" */
  variant?: ErrorFallbackVariant | undefined;
}

const TITLES: Record<ErrorFallbackVariant, string> = {
  full: "Something went wrong",
  page: "Something went wrong",
  inline: "Error loading chart data",
};

/**
 * Unified error fallback component with three variants:
 *
 * - "full"   — the app's top-level error boundary (index.tsx), outside the router
 * - "page"   — route error components (`__root`, `$sport`, `demo/$sport`)
 * - "inline" — a chart that failed, inside its panel (`ErrorChart`)
 *
 * Each is an `ErrorState`. The full and page variants stand in for a whole page, so they
 * frame it in a danger-toned panel and title it with the page's `h1`; the inline one sits in
 * its parent's panel at the outline's level (under a chart's title, one below it).
 */
export function PageErrorFallback({ error, onReset, variant = "page" }: PageErrorFallbackProps) {
  const title = TITLES[variant];
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (variant === "inline") {
    return (
      <ErrorState title={title} onRetry={onReset}>
        {errorMessage}
      </ErrorState>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <Panel tone="danger">
        <ErrorState
          level={1}
          title={title}
          onRetry={onReset}
          actions={
            // The full variant renders outside the router, so it has no link to follow.
            variant === "page" && (
              <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Go to Dashboard
              </Link>
            )
          }
        >
          {errorMessage}
        </ErrorState>
      </Panel>
    </div>
  );
}
