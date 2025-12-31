import NeonSpinner from "../NeonSpinner";

/**
 * Simple loading spinner for charts
 *
 * Displays a neon-colored spinner while chart data is loading.
 * Uses visually-hidden text for screen reader accessibility.
 */
export default function LoadingChart() {
  return (
    <div
      className="d-flex justify-content-center align-items-center"
      style={{ minHeight: "300px" }}
      aria-label="Loading chart data"
    >
      <NeonSpinner />
    </div>
  );
}
