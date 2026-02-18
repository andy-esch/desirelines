import { Link } from "react-router-dom";

type ErrorFallbackVariant = "page" | "inline" | "full";

interface PageErrorFallbackProps {
  error: Error;
  onReset?: () => void;
  /** @default "page" */
  variant?: ErrorFallbackVariant;
  /** Custom heading (defaults vary by variant) */
  heading?: string;
}

const defaultHeadings: Record<ErrorFallbackVariant, string> = {
  full: "Something went wrong",
  page: "Something went wrong",
  inline: "Failed to load chart data",
};

/**
 * Unified error fallback component with three variants:
 *
 * - "full"   — Full-page layout for top-level error boundaries (index.tsx)
 * - "page"   — Container-width card for route-level errors (App.tsx)
 * - "inline" — Compact alert for component-level errors (charts, cards)
 */
export function PageErrorFallback({
  error,
  onReset,
  variant = "page",
  heading,
}: PageErrorFallbackProps) {
  const title = heading ?? defaultHeadings[variant];

  // Full-page: monospace layout, no router available
  if (variant === "full") {
    return (
      <div className="p-10 font-mono max-w-3xl mx-auto">
        <h1 className="text-red-500">{title}</h1>
        <p>The application encountered an unexpected error.</p>
        <pre className="bg-slate-dark text-body-text p-5 rounded overflow-auto">
          {error.message}
        </pre>
        {onReset && (
          <button onClick={onReset} className="mt-4 py-2 px-4 cursor-pointer">
            Try Again
          </button>
        )}
      </div>
    );
  }

  // Inline: compact alert for component-level errors
  if (variant === "inline") {
    return (
      <div className="alert alert-danger" role="alert">
        <h4 className="alert-heading">{title}</h4>
        <p>{error.message}</p>
        {onReset && (
          <>
            <hr />
            <button className="btn btn-outline-danger" onClick={onReset}>
              Retry
            </button>
          </>
        )}
      </div>
    );
  }

  // Page (default): container-width card for route-level errors
  return (
    <div className="container py-12" style={{ maxWidth: "600px" }}>
      <div className="alert alert-danger" role="alert">
        <h4 className="alert-heading">{title}</h4>
        <p>This page encountered an unexpected error.</p>
        <hr />
        <p className="mb-6">
          <strong>Error:</strong> {error.message}
        </p>
        <div className="flex gap-2">
          {onReset && (
            <button
              className="btn btn-outline-danger"
              onClick={onReset}
              aria-label="Try Again: Retry loading this page"
            >
              Try Again
            </button>
          )}
          <Link to="/" className="btn btn-outline-secondary">
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
