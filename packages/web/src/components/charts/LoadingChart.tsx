import NeonSpinner from "../NeonSpinner";

/**
 * Simple loading spinner for charts
 *
 * Displays a neon-colored spinner while chart data is loading.
 * Uses sr-only text for screen reader accessibility.
 */
export default function LoadingChart() {
  return (
    <div
      className="flex justify-center items-center"
      style={{ minHeight: "300px" }}
      aria-label="Loading chart data"
    >
      <NeonSpinner />
    </div>
  );
}
