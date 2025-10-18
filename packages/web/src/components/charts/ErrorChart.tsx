interface ErrorChartProps {
  error: Error;
  onRetry: () => void;
}

export default function ErrorChart({ error, onRetry }: ErrorChartProps) {
  return (
    <div className="alert alert-danger" role="alert">
      <h4 className="alert-heading">Failed to load chart data</h4>
      <p>{error.message}</p>
      <hr />
      <button className="btn btn-outline-danger" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
