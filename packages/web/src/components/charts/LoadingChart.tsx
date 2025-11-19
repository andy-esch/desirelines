/**
 * Simple loading spinner for charts
 *
 * Displays a Bootstrap spinner while chart data is loading.
 * Uses visually-hidden text for screen reader accessibility.
 */
export default function LoadingChart() {
  return (
    <div
      className="d-flex justify-content-center align-items-center"
      style={{ minHeight: "300px" }}
      role="status"
      aria-label="Loading chart data"
    >
      <div className="spinner-border text-primary">
        <span className="visually-hidden">Loading...</span>
      </div>
    </div>
  );
}
