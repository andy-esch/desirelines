import { useAuth } from "../hooks/useAuth";
import SportPage from "./SportPage";
import DemoSportPage from "./DemoSportPage";
import SportPageSkeleton from "../components/skeletons/SportPageSkeleton";

interface UnifiedSportPageProps {
  sport: string;
  year: string;
}

/**
 * Unified sport page that renders the appropriate version based on auth state.
 *
 * - Authenticated users: SportPage with real API data
 * - Unauthenticated users: DemoSportPage with demo data
 */
export default function UnifiedSportPage({ sport, year }: UnifiedSportPageProps) {
  const { user, loading } = useAuth();

  // Show loading while auth state is being determined
  if (loading) {
    return <SportPageSkeleton />;
  }

  // Render appropriate page based on auth state
  return user ? (
    <SportPage sport={sport} year={year} />
  ) : (
    <DemoSportPage sport={sport} year={year} />
  );
}
