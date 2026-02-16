import { Link } from "react-router-dom";

interface PageErrorFallbackProps {
  error: Error;
  onReset: () => void;
}

export function PageErrorFallback({ error, onReset }: PageErrorFallbackProps) {
  return (
    <div className="container py-12" style={{ maxWidth: "600px" }}>
      <div className="alert alert-danger" role="alert">
        <h4 className="alert-heading">Something went wrong</h4>
        <p>This page encountered an unexpected error.</p>
        <hr />
        <p className="mb-6">
          <strong>Error:</strong> {error.message}
        </p>
        <div className="flex gap-2">
          <button
            className="btn btn-outline-danger"
            onClick={onReset}
            aria-label="Try Again: Retry loading this page"
          >
            Try Again
          </button>
          <Link to="/" className="btn btn-outline-secondary">
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
