import { useState } from "react";
import { useAuth } from "../hooks/useAuth";

/**
 * Authentication button component
 * Shows "Connect with Strava" for anonymous users, "Sign Out" for authenticated users
 */
export default function AuthButton() {
  const { user, loading, error, signIn, signOut } = useAuth();
  const [actionLoading, setActionLoading] = useState(false);

  // Don't show anything while loading
  if (loading) {
    return null;
  }

  const handleSignIn = async () => {
    setActionLoading(true);
    try {
      await signIn();
    } catch {
      // Error is already set in useAuth state
    } finally {
      setActionLoading(false);
    }
  };

  const handleSignOut = async () => {
    setActionLoading(true);
    try {
      await signOut();
    } catch {
      // Error is already set in useAuth state
    } finally {
      setActionLoading(false);
    }
  };

  // Show sign out button for authenticated users
  if (user) {
    return (
      <div>
        <button
          onClick={() => void handleSignOut()}
          className="btn btn-sm btn-outline-light"
          disabled={actionLoading}
        >
          {actionLoading ? "Signing out..." : "Sign Out"}
        </button>
        {error && (
          <div className="text-danger text-sm mt-1" role="alert">
            {error.message}
          </div>
        )}
      </div>
    );
  }

  // Show Strava connect button for anonymous users
  return (
    <div>
      <button
        onClick={() => void handleSignIn()}
        className="btn btn-sm btn-primary"
        disabled={actionLoading}
      >
        {actionLoading ? "Connecting..." : "Connect with Strava"}
      </button>
      {error && (
        <div className="text-danger text-sm mt-1" role="alert">
          {error.message}
        </div>
      )}
    </div>
  );
}
