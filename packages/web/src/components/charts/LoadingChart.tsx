import Loader from "../Loader";

/**
 * A chart's loading state: the theme's `Loader`, which carries its own label and status
 * role, centered in the chart's height while its data loads.
 */
export default function LoadingChart() {
  return (
    <div className="flex justify-center items-center" style={{ minHeight: "300px" }}>
      <Loader />
    </div>
  );
}
