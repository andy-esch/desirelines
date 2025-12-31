import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import NeonSpinner from "./NeonSpinner";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Route wrapper that redirects unauthenticated users to the landing page.
 * Shows loading spinner while auth state is being determined.
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  // Show loading state while checking auth
  if (loading) {
    return (
      <div
        className="container d-flex justify-content-center align-items-center"
        style={{ minHeight: "80vh" }}
      >
        <NeonSpinner />
      </div>
    );
  }

  // Redirect to landing page if not authenticated
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
