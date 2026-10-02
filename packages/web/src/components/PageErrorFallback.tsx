import { Link } from "@tanstack/react-router";
import { buttonVariants } from "./ui/button";
import { ErrorState } from "./ErrorState";
import { Panel } from "./theme/Panel";

type ErrorFallbackVariant = "page" | "full";

interface PageErrorFallbackProps {
  error: unknown;
  onReset?: (() => void) | undefined;
  /** @default "page" */
  variant?: ErrorFallbackVariant | undefined;
}

/**
 * What shows in place of a page that threw: an `ErrorState` titled with the page's `h1`, in a
 * danger-toned panel.
 *
 * - "page" — route error components (`__root`, `$sport`, `demo/$sport`), with a link home
 * - "full" — the app's top-level error boundary (index.tsx), outside the router
 */
export function PageErrorFallback({ error, onReset, variant = "page" }: PageErrorFallbackProps) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <Panel tone="danger">
        <ErrorState
          level={1}
          title="Something went wrong"
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
