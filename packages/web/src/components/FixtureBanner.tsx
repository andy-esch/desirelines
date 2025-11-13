import { USE_FIXTURE_DATA } from "../config";
import { useAuth } from "../hooks/useAuth";

/**
 * Banner that displays when app is in fixture/demo mode
 * Shows prominent notice that data is not connected to real backend
 *
 * Smart mode: Only shows for anonymous users when USE_FIXTURE_DATA=true
 * Authenticated users see backend data, so no banner is needed
 */
export default function FixtureBanner() {
  const { user, loading } = useAuth();

  // Don't render banner while auth state is loading
  if (loading) {
    return null;
  }

  // Only render if fixtures are being used (anonymous user in fixture-enabled environment)
  // When user is authenticated, they see backend data even if USE_FIXTURE_DATA=true
  const usingFixtures = USE_FIXTURE_DATA && !user;

  if (!usingFixtures) {
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
