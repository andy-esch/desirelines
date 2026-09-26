import NeonSpinner from "../NeonSpinner";

/**
 * Simple loading spinner for charts
 *
 * Shows the theme's loading indicator while chart data loads.
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
