interface ErrorChartProps {
  error: Error;
  onRetry?: () => void;
}

export default function ErrorChart({ error, onRetry }: ErrorChartProps) {
  const handleRetry = onRetry || (() => window.location.reload());

  return (
    <div className="alert alert-danger" role="alert">
      <h4 className="alert-heading">Failed to load chart data</h4>
      <p>{error.message}</p>
      <hr />
      <button className="btn btn-outline-danger" onClick={handleRetry}>
        Retry
      </button>
    </div>
  );
}
