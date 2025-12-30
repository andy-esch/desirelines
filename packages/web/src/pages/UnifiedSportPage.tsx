import { useAuth } from "../hooks/useAuth";
import SportPage from "./SportPage";
import DemoSportPage from "./DemoSportPage";
import NeonSpinner from "../components/NeonSpinner";

interface UnifiedSportPageProps {
  sport: string;
}

/**
 * Unified sport page that renders the appropriate version based on auth state.
 *
 * - Authenticated users: SportPage with real API data
 * - Unauthenticated users: DemoSportPage with fixture data
 */
export default function UnifiedSportPage({ sport }: UnifiedSportPageProps) {
  const { user, loading } = useAuth();

  // Show loading while auth state is being determined
  if (loading) {
    return (
      <div
        className="container d-flex justify-content-center align-items-center"
        style={{ minHeight: "60vh" }}
      >
        <NeonSpinner />
      </div>
    );
  }

  // Render appropriate page based on auth state
  if (user) {
    return <SportPage sport={sport} />;
  }

  return <DemoSportPage sport={sport} />;
}
