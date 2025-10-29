import { USE_FIXTURE_DATA } from "../config";

/**
 * Banner that displays when app is in fixture/demo mode
 * Shows prominent notice that data is not connected to real backend
 */
export default function FixtureBanner() {
  // Only render if in fixture mode
  if (!USE_FIXTURE_DATA) {
    return null;
  }

  return (
    <div
      className="alert alert-info mb-0 rounded-0 text-center"
      role="alert"
      style={{
        borderLeft: "none",
        borderRight: "none",
        borderTop: "none",
      }}
    >
      <strong>Demo Mode:</strong> This app is running with fixture data. Changes will not be
      persisted.
    </div>
  );
}
